import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { applyDocumentReviewCleared } from '@/db/repositories/document-review'
import { findHealthScreeningSubject, recordPassingResultDate } from '@/db/repositories/health-screening'
import { changeRequirementInstanceStatus } from '@/db/repositories/requirement-instances'
import { readMedicalClearanceResults, recordMedicalScreeningResult } from '@/db/restricted/medical'
import {
  type HealthScreeningRefusal,
  awaitsHealthScreeningResult,
  healthScreeningItemOf,
  healthScreeningResultStatus,
  recordHealthScreeningResultInputSchema,
} from '@/domain/requirements/health-screening'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type RecordHealthScreeningResultResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: HealthScreeningRefusal | 'CAREGIVER_WITHDRAWN' }

/**
 * The result goes into the medical store and is read back through its one clearance read; every
 * core write is derived from what the store returned, never from the input, so core cannot hold a
 * value the store does not. A PASS satisfies the requirement with its date, a FAIL returns it for
 * a new upload. The caregiver is not emailed about a FAIL.
 */
export const recordHealthScreeningResult: UseCase<
  { readonly instanceId: string; readonly outcome: string; readonly resultedOn: string },
  RecordHealthScreeningResultResult
> = defineUseCase('healthScreening.record', async ({ principal, input: raw }) => {
  const { instanceId, outcome, resultedOn } = recordHealthScreeningResultInputSchema.parse(raw)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx): Promise<RecordHealthScreeningResultResult> => {
    const subject = await findHealthScreeningSubject(agencyId, instanceId)
    if (subject === null) {
      throw new Error(`Requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
    }
    if (subject.caregiverStage === 'WITHDRAWN') return { ok: false, reason: 'CAREGIVER_WITHDRAWN' }
    const item = healthScreeningItemOf(subject.templateKey)
    if (item === null || !awaitsHealthScreeningResult(subject)) return { ok: false, reason: 'NOT_AWAITING_RESULT' }

    const { caregiverId } = subject
    await recordMedicalScreeningResult(agencyId, caregiverId, { item, outcome, resultedOn })
    const recorded = (await readMedicalClearanceResults(agencyId, caregiverId)).find((result) => result.item === item)
    if (recorded === undefined) throw new Error(`The ${item} result just recorded for ${caregiverId} was not read back.`)

    const to = healthScreeningResultStatus(recorded.outcome)
    const change = await changeRequirementInstanceStatus(agencyId, instanceId, to)
    if (!change.ok) {
      throw new Error(
        `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
          `(${change.refusal}); a concurrent writer changed it.`,
      )
    }
    if (to === 'SATISFIED') {
      await recordPassingResultDate(tx, agencyId, instanceId, recorded.resultedOn)
      await applyDocumentReviewCleared(tx, agencyId, caregiverId, principal.id)
    }
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: caregiverId,
      fieldName: 'healthScreeningResults',
    })
    return { ok: true }
  })
})
