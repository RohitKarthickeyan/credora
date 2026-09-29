import 'server-only'
import { addSeconds } from 'date-fns'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import {
  advanceBackgroundCheckOrder,
  findOrderForPlacement,
  findOrderForReconcile,
  recordVendorOrder,
} from '@/db/repositories/background-check-orders'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { createCheckResult } from '@/db/repositories/check-results'
import { registerWebhookSubject } from '@/db/repositories/inbound-webhooks'
import { createSchedule } from '@/db/repositories/job-schedules'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  BACKGROUND_CHECK_RESULT_EVIDENCE_KEY,
  RESULT_INSTANCE_STATUS,
  fcraConsentOnFile,
  isFinalOrderStatus,
  reconcileOrderStatus,
} from '@/domain/requirements/background-check'
import { type JobOutcome, defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { stopSchedule } from '@/integrations/queue/schedule'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { WEBHOOK_JOB_TYPES, backgroundCheckWebhookJobPayloadSchema } from '@/server/webhooks/jobs'

export const BACKGROUND_CHECK_ORDER_JOB_TYPE = 'backgroundCheck.order'
const BACKGROUND_CHECK_POLL_JOB_TYPE = 'backgroundCheck.poll'

// Hourly until the product owner sets a polling cadence.
const POLL_INTERVAL_SECONDS = 3600

const pollScheduleKey = (orderId: string) => `backgroundCheck.poll:${orderId}`

const orderPayloadSchema = z.object({ backgroundCheckOrderId: z.uuid() })

// Idempotent, and it cannot join the transaction that records the vendor order, so a retry of
// an order already placed runs it again in case it failed after that commit.
async function startPolling(agencyId: string, backgroundCheckOrderId: string, now: Date): Promise<JobOutcome> {
  await createSchedule({
    agencyId,
    key: pollScheduleKey(backgroundCheckOrderId),
    jobType: BACKGROUND_CHECK_POLL_JOB_TYPE,
    payload: { backgroundCheckOrderId },
    intervalSeconds: POLL_INTERVAL_SECONDS,
    firstOccurrenceAt: addSeconds(now, POLL_INTERVAL_SECONDS),
  })
  return { status: 'ok' }
}

function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}) while a background check result was recorded.`,
  )
}

/**
 * Places a REQUESTED order with the agency's vendor. FCRA requires the signed standalone
 * disclosure before the check runs, so it is asserted again here, at the moment the check is
 * actually ordered. The vendor call is outside any transaction; a VendorUnavailableError escapes
 * so the queue retries with the same idempotency key. A WITHDRAWN caregiver ends the job with no
 * vendor call (ADR-079).
 */
export const backgroundCheckOrderJob = defineJobHandler({
  type: BACKGROUND_CHECK_ORDER_JOB_TYPE,
  schema: orderPayloadSchema,
  run: ({ backgroundCheckOrderId }, { agencyId, now }) =>
    runAsSystem(async () => {
      const order = await findOrderForPlacement(agencyId, backgroundCheckOrderId)
      if (order === null) return { status: 'ok' }
      if (order.status !== 'REQUESTED') return startPolling(agencyId, backgroundCheckOrderId, now)
      const caregiver = await findCaregiverForSession(agencyId, order.caregiverId)
      if (caregiver === null || caregiver.stage === 'WITHDRAWN') return { status: 'ok' }
      if (!fcraConsentOnFile(await findSignedDocuments(agencyId, order.caregiverId))) {
        return { status: 'fail', reason: 'No signed FCRA disclosure is on file; the check was not ordered.' }
      }
      if (order.subject === null) {
        return {
          status: 'fail',
          reason: "The caregiver's legal name or date of birth is missing; the check was not ordered.",
        }
      }

      const vendor = await getPort('backgroundCheck').order({
        agencyId,
        caregiverId: order.caregiverId,
        packageCode: order.packageCode,
        subject: order.subject,
        idempotencyKey: buildIdempotencyKey('backgroundCheck.placeOrder', [backgroundCheckOrderId]),
      })

      await runInAuditedTransaction(async (tx) => {
        if (!(await recordVendorOrder(tx, agencyId, backgroundCheckOrderId, vendor.orderId))) return
        await registerWebhookSubject(tx, agencyId, { provider: 'backgroundCheck', externalId: vendor.orderId })
        // The legal name and date of birth left Credora for the vendor.
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EXPORT',
          entityType: 'CAREGIVER',
          entityId: order.caregiverId,
          fieldName: 'backgroundCheck',
        })
      })

      return startPolling(agencyId, backgroundCheckOrderId, now)
    }),
})

/**
 * The poll and the callback share this. The vendor's order is re-read and the event body never
 * is (T-052). Status only moves forward; CLEAR satisfies the requirement with a vendor-reported
 * check result, CONSIDER puts it in review for a person and never fails anyone. Nothing is
 * recorded for a WITHDRAWN caregiver (ADR-079); stopping our own poll is scheduler housekeeping.
 */
async function reconcile(
  agencyId: string,
  by: { readonly id: string } | { readonly vendorOrderId: string },
  now: Date,
): Promise<JobOutcome> {
  const order = await findOrderForReconcile(agencyId, by)
  if (order === null) {
    if ('id' in by) await stopSchedule(agencyId, pollScheduleKey(by.id), now)
    return { status: 'ok' }
  }
  if (order.vendorOrderId === null) return { status: 'ok' }

  const caregiver = await findCaregiverForSession(agencyId, order.caregiverId)
  if (caregiver === null || caregiver.stage === 'WITHDRAWN') {
    await stopSchedule(agencyId, pollScheduleKey(order.id), now)
    return { status: 'ok' }
  }

  const vendor = await getPort('backgroundCheck').getOrder(agencyId, order.vendorOrderId)
  if (vendor === null) {
    return { status: 'fail', reason: `The vendor has no background check order ${order.vendorOrderId}.` }
  }

  const change = reconcileOrderStatus(order.status, vendor.status)
  if (change.kind === 'conflict') {
    return {
      status: 'fail',
      reason: `The vendor reports ${vendor.status} for an order already recorded as ${order.status}; a person must look.`,
    }
  }
  if (change.kind === 'unchanged') {
    if (isFinalOrderStatus(order.status)) await stopSchedule(agencyId, pollScheduleKey(order.id), now)
    return { status: 'ok' }
  }

  const { to } = change
  const final = isFinalOrderStatus(to)
  await runInAuditedTransaction(async (tx) => {
    const moved = await advanceBackgroundCheckOrder(tx, agencyId, order.id, {
      from: order.status,
      to,
      resultAt: final ? now : null,
    })
    if (!moved) return

    if (final) {
      const { instance } = order
      if (instance === null || instance.status !== 'PENDING') {
        throw new Error(
          `Background check order ${order.id} returned ${to}, but its requirement instance is ` +
            `${instance === null ? 'missing' : instance.status}, not PENDING.`,
        )
      }
      if (to === 'CLEAR') {
        const checkResult = await createCheckResult(agencyId, order.caregiverId, null)
        const link = await linkEvidence(agencyId, instance.id, BACKGROUND_CHECK_RESULT_EVIDENCE_KEY, {
          kind: 'CHECK_RESULT',
          checkResultId: checkResult.id,
        })
        if (!link.ok) {
          throw new Error(
            `Requirement instance ${instance.id} does not accept CHECK_RESULT ${BACKGROUND_CHECK_RESULT_EVIDENCE_KEY}.`,
          )
        }
        requireChanged(
          await changeRequirementInstanceStatus(agencyId, instance.id, RESULT_INSTANCE_STATUS.CLEAR),
          instance.id,
        )
        await applyVerificationCompleted(tx, agencyId, order.caregiverId, null)
      } else {
        requireChanged(
          await changeRequirementInstanceStatus(agencyId, instance.id, RESULT_INSTANCE_STATUS.CONSIDER),
          instance.id,
        )
      }
    }

    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: order.caregiverId,
      fieldName: 'backgroundCheck',
    })
  })

  if (final) await stopSchedule(agencyId, pollScheduleKey(order.id), now)
  return { status: 'ok' }
}

export const backgroundCheckPollJob = defineJobHandler({
  type: BACKGROUND_CHECK_POLL_JOB_TYPE,
  schema: orderPayloadSchema,
  run: ({ backgroundCheckOrderId }, { agencyId, now }) =>
    runAsSystem(() => reconcile(agencyId, { id: backgroundCheckOrderId }, now)),
})

export const backgroundCheckWebhookJob = defineJobHandler({
  type: WEBHOOK_JOB_TYPES.backgroundCheck,
  schema: backgroundCheckWebhookJobPayloadSchema,
  run: ({ orderId }, { agencyId, now }) => runAsSystem(() => reconcile(agencyId, { vendorOrderId: orderId }, now)),
})
