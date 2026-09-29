import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createCheckResult } from '@/db/repositories/check-results'
import { findManualCheckRows, findManualCheckSubject } from '@/db/repositories/manual-checks'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  type ManualCheckRefusal,
  type ManualCheckTask,
  manualCheckOf,
  manualCheckPath,
  outstandingManualChecks,
  recordManualCheckInputSchema,
} from '@/domain/requirements/manual-check'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const listManualChecks: UseCase<Record<string, never>, readonly ManualCheckTask[]> = defineUseCase(
  'manualCheck.list',
  async ({ principal }) => outstandingManualChecks(await findManualCheckRows(principal.agencyId)),
)

type RecordManualCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'NOT_A_MANUAL_CHECK' | 'CAREGIVER_WITHDRAWN' | ManualCheckRefusal
    }

// The path was computed from the status just read, so any refusal means a concurrent writer.
function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

/**
 * I-9 §2 and the NY Home Care Registry lookup are a person's job (PRD § 3): this staff record is
 * the only way a manual-only requirement reaches SATISFIED. Satisfying the last blocking
 * requirement moves the caregiver to Clearance (ADR-113).
 */
export const recordManualCheck: UseCase<{ readonly instanceId: string }, RecordManualCheckResult> =
  defineUseCase('manualCheck.record', async ({ principal, input: raw }) => {
    const { instanceId } = recordManualCheckInputSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<RecordManualCheckResult> => {
      const subject = await findManualCheckSubject(agencyId, instanceId)
      if (subject === null) {
        throw new Error(`Requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
      }
      if (subject.caregiverStage === 'WITHDRAWN') return { ok: false, reason: 'CAREGIVER_WITHDRAWN' }

      const check = manualCheckOf(subject.template)
      if (check === null) return { ok: false, reason: 'NOT_A_MANUAL_CHECK' }

      const path = manualCheckPath(subject.status)
      if (!path.ok) return { ok: false, reason: path.refusal }

      for (const step of path.steps.slice(0, -1)) {
        requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, step), instanceId)
      }

      const checkResult = await createCheckResult(agencyId, subject.caregiverId, principal.id)
      const link = await linkEvidence(agencyId, instanceId, check.evidenceKey, {
        kind: 'CHECK_RESULT',
        checkResultId: checkResult.id,
      })
      if (!link.ok) {
        throw new Error(
          `Requirement instance ${instanceId} does not accept CHECK_RESULT ${check.evidenceKey}.`,
        )
      }
      requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'SATISFIED'), instanceId)
      await applyVerificationCompleted(tx, agencyId, subject.caregiverId, principal.id)

      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: subject.caregiverId,
        fieldName: 'checkResults',
      })
      return { ok: true }
    })
  })
