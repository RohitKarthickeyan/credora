import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createCheckResult } from '@/db/repositories/check-results'
import {
  createBackgroundCheckOrder,
  findBackgroundCheckRows,
  findBackgroundCheckSubject,
} from '@/db/repositories/background-check-orders'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  ADJUDICATION_INSTANCE_STATUS,
  BACKGROUND_CHECK_RESULT_EVIDENCE_KEY,
  type BackgroundCheckAdjudicationRefusal,
  type BackgroundCheckOrderRefusal,
  type BackgroundCheckTask,
  adjudicateBackgroundCheckRequestSchema,
  backgroundCheckAdjudicationRefusal,
  backgroundCheckOrderRefusal,
  fcraConsentOnFile,
  orderBackgroundCheckRequestSchema,
  outstandingBackgroundChecks,
} from '@/domain/requirements/background-check'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { BACKGROUND_CHECK_ORDER_JOB_TYPE } from './background-check-jobs'

// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const listBackgroundChecks: UseCase<Record<string, never>, readonly BackgroundCheckTask[]> = defineUseCase(
  'backgroundCheck.list',
  async ({ principal }) => outstandingBackgroundChecks(await findBackgroundCheckRows(principal.agencyId)),
)

type OrderBackgroundCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BackgroundCheckOrderRefusal }

// The step was allowed for the status just read, so any refusal means a concurrent writer.
function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

/**
 * FCRA requires the signed standalone disclosure before any check runs, so this refuses without
 * it and the order job checks again before it calls the vendor.
 */
export const orderBackgroundCheck: UseCase<{ readonly instanceId: string }, OrderBackgroundCheckResult> =
  defineUseCase('backgroundCheck.order', async ({ principal, input: raw }) => {
    const { instanceId } = orderBackgroundCheckRequestSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<OrderBackgroundCheckResult> => {
      const subject = await findBackgroundCheckSubject(agencyId, instanceId)
      if (subject === null) {
        throw new Error(`Background check requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
      }
      const fcraSigned = fcraConsentOnFile(await findSignedDocuments(agencyId, subject.caregiverId))

      const refusal = backgroundCheckOrderRefusal({
        stage: subject.caregiverStage,
        status: subject.status,
        ordered: subject.ordered,
        fcraSigned,
        packageCode: subject.packageCode,
        subjectComplete: subject.subjectComplete,
      })
      if (refusal !== null || subject.packageCode === null) {
        return { ok: false, reason: refusal ?? 'NO_PACKAGE_CODE' }
      }

      requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING'), instanceId)
      const order = await createBackgroundCheckOrder(tx, agencyId, {
        caregiverId: subject.caregiverId,
        requestedByUserId: principal.id,
        packageCode: subject.packageCode,
      })
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: BACKGROUND_CHECK_ORDER_JOB_TYPE,
        payload: { backgroundCheckOrderId: order.id },
        idempotencyKey: buildIdempotencyKey(BACKGROUND_CHECK_ORDER_JOB_TYPE, [order.id]),
      })
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: subject.caregiverId,
        fieldName: 'backgroundCheck',
      })
      return { ok: true }
    })
  })

type AdjudicateBackgroundCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BackgroundCheckAdjudicationRefusal }

/**
 * A person decides a CONSIDER after reviewing the report with the vendor. A fail blocks clearance
 * but withdraws no one; FCRA adverse-action notices are sent outside Credora.
 */
export const adjudicateBackgroundCheck: UseCase<
  { readonly instanceId: string; readonly adjudication: string },
  AdjudicateBackgroundCheckResult
> = defineUseCase('backgroundCheck.adjudicate', async ({ principal, input: raw }) => {
  const { instanceId, adjudication } = adjudicateBackgroundCheckRequestSchema.parse(raw)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx): Promise<AdjudicateBackgroundCheckResult> => {
    const subject = await findBackgroundCheckSubject(agencyId, instanceId)
    if (subject === null) {
      throw new Error(`Background check requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
    }
    const refusal = backgroundCheckAdjudicationRefusal({
      stage: subject.caregiverStage,
      status: subject.status,
      orderStatus: subject.orderStatus,
    })
    if (refusal !== null) return { ok: false, reason: refusal }

    if (adjudication === 'CLEARED_AFTER_REVIEW') {
      const checkResult = await createCheckResult(agencyId, subject.caregiverId, principal.id)
      const link = await linkEvidence(agencyId, instanceId, BACKGROUND_CHECK_RESULT_EVIDENCE_KEY, {
        kind: 'CHECK_RESULT',
        checkResultId: checkResult.id,
      })
      if (!link.ok) {
        throw new Error(
          `Requirement instance ${instanceId} does not accept CHECK_RESULT ${BACKGROUND_CHECK_RESULT_EVIDENCE_KEY}.`,
        )
      }
      requireChanged(
        await changeRequirementInstanceStatus(agencyId, instanceId, ADJUDICATION_INSTANCE_STATUS.CLEARED_AFTER_REVIEW),
        instanceId,
      )
      await applyVerificationCompleted(tx, agencyId, subject.caregiverId, principal.id)
    } else {
      requireChanged(
        await changeRequirementInstanceStatus(agencyId, instanceId, ADJUDICATION_INSTANCE_STATUS.FAILED_AFTER_REVIEW),
        instanceId,
      )
    }
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: subject.caregiverId,
      fieldName: 'backgroundCheck',
    })
    return { ok: true }
  })
})
