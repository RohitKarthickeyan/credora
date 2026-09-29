import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createCheckResult } from '@/db/repositories/check-results'
import { createChrcSubmission, findChrcRows, findChrcSubject } from '@/db/repositories/chrc'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  CHRC_RESULT_EVIDENCE_KEY,
  type ChrcRefusal,
  type ChrcTask,
  chrcStepRefusal,
  outstandingChrcChecks,
  recordChrcStepInputSchema,
} from '@/domain/requirements/chrc'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const listChrcChecks: UseCase<Record<string, never>, readonly ChrcTask[]> = defineUseCase(
  'chrc.list',
  async ({ principal }) => outstandingChrcChecks(await findChrcRows(principal.agencyId)),
)

type RecordChrcStepResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ChrcRefusal | 'CAREGIVER_WITHDRAWN' }

// The step was allowed for the status just read, so any refusal means a concurrent writer.
function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

/**
 * The NY DOH fingerprint process is tracked by staff, not integrated (PRD § 5). The step is
 * explicit so a stale "Record submission" click can never record a result. Satisfying the last
 * blocking requirement moves the caregiver to Clearance (ADR-113).
 */
export const recordChrcStep: UseCase<{ readonly instanceId: string; readonly step: string }, RecordChrcStepResult> =
  defineUseCase('chrc.record', async ({ principal, input: raw }) => {
    const { instanceId, step } = recordChrcStepInputSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<RecordChrcStepResult> => {
      const subject = await findChrcSubject(agencyId, instanceId)
      if (subject === null) {
        throw new Error(`CHRC requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
      }
      if (subject.caregiverStage === 'WITHDRAWN') return { ok: false, reason: 'CAREGIVER_WITHDRAWN' }

      const refusal = chrcStepRefusal(step, subject.status, subject.submitted)
      if (refusal !== null) return { ok: false, reason: refusal }

      if (step === 'SUBMISSION') {
        requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING'), instanceId)
        await createChrcSubmission(agencyId, subject.caregiverId, principal.id)
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'CAREGIVER',
          entityId: subject.caregiverId,
          fieldName: 'chrcSubmission',
        })
        return { ok: true }
      }

      const checkResult = await createCheckResult(agencyId, subject.caregiverId, principal.id)
      const link = await linkEvidence(agencyId, instanceId, CHRC_RESULT_EVIDENCE_KEY, {
        kind: 'CHECK_RESULT',
        checkResultId: checkResult.id,
      })
      if (!link.ok) {
        throw new Error(`Requirement instance ${instanceId} does not accept CHECK_RESULT ${CHRC_RESULT_EVIDENCE_KEY}.`)
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
