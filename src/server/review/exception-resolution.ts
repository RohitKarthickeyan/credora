import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { applyDocumentReviewCleared } from '@/db/repositories/document-review'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { changeRequirementInstanceStatus } from '@/db/repositories/requirement-instances'
import {
  findDecisionTarget,
  findWaiverTarget,
  recordRequirementWaiver,
  saveStaffDocumentDecision,
} from '@/db/repositories/staff-decisions'
import {
  STAFF_DECISIONS,
  type StaffDecision,
  isDecidable,
  isWaivable,
  queueDecisionInputSchema,
} from '@/domain/documents/staff-decision'
import { staffAcceptSteps } from '@/domain/requirements/health-screening'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { CAREGIVER_NOTICE_JOB_TYPE } from './caregiver-notice-job'

export type DecideFlaggedDocumentResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NO_LONGER_FLAGGED' }

export type WaiveRequirementResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'NOT_WAIVABLE' }

const decideInputSchema = queueDecisionInputSchema.extend({ decision: z.enum(STAFF_DECISIONS) })
const waiveInputSchema = queueDecisionInputSchema.pick({ instanceId: true })

// Legal from the status the caller has just re-read in this transaction (EXCEPTION, or the previous
// step); a refusal means a concurrent writer, which rolls the whole decision back (T-032 § Risks 6).
async function moveInstance(agencyId: string, instanceId: string, to: InstanceStatus): Promise<void> {
  const change = await changeRequirementInstanceStatus(agencyId, instanceId, to)
  if (!change.ok) throw new Error(`Requirement instance ${instanceId} refused ${change.from} → ${to}: ${change.refusal}.`)
}

/**
 * Staff decide one flagged document (ADR-110). The item is re-read in this transaction, because a
 * queue row can be stale. ACCEPTED satisfies the requirement (a health screening then awaits its
 * result); a return leaves it EXCEPTION and queues the caregiver's email. Staff accept without
 * seeing the image (OPEN-QUESTIONS 102).
 */
export const decideFlaggedDocument: UseCase<
  { readonly instanceId: string; readonly uploadedDocumentId: string; readonly decision: StaffDecision },
  DecideFlaggedDocumentResult
> = defineUseCase('exceptionQueue.decide', async ({ principal, input: raw }) => {
  const { instanceId, uploadedDocumentId, decision } = decideInputSchema.parse(raw)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx): Promise<DecideFlaggedDocumentResult> => {
    const target = await findDecisionTarget(tx, agencyId, { instanceId, uploadedDocumentId })
    if (target === null || !isDecidable(target)) return { ok: false, reason: 'NO_LONGER_FLAGGED' }

    if (decision === 'ACCEPTED') {
      for (const to of staffAcceptSteps(target.templateKey)) await moveInstance(agencyId, instanceId, to)
    }
    const { id } = await saveStaffDocumentDecision(tx, agencyId, {
      uploadedDocumentId,
      decision,
      decidedByUserId: principal.id,
    })
    if (decision === 'ACCEPTED') {
      await applyDocumentReviewCleared(tx, agencyId, target.caregiverId, principal.id)
    } else {
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: CAREGIVER_NOTICE_JOB_TYPE,
        payload: { staffDecisionId: id },
        idempotencyKey: buildIdempotencyKey(CAREGIVER_NOTICE_JOB_TYPE, [id]),
      })
    }
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: target.caregiverId,
      fieldName: 'staffDocumentDecisions',
    })
    return { ok: true }
  })
})

/** Waives an EXCEPTION requirement with who and when on the instance; emails nobody (ADR-110). */
export const waiveRequirement: UseCase<{ readonly instanceId: string }, WaiveRequirementResult> = defineUseCase(
  'requirement.waive',
  async ({ principal, input: raw }) => {
    const { instanceId } = waiveInputSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<WaiveRequirementResult> => {
      const target = await findWaiverTarget(tx, agencyId, instanceId)
      if (target === null || !isWaivable(target)) return { ok: false, reason: 'NOT_WAIVABLE' }

      await moveInstance(agencyId, instanceId, 'WAIVED')
      await recordRequirementWaiver(tx, agencyId, instanceId, principal.id)
      await applyDocumentReviewCleared(tx, agencyId, target.caregiverId, principal.id)
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: target.caregiverId,
        fieldName: 'waivedAt',
      })
      return { ok: true }
    })
  },
)
