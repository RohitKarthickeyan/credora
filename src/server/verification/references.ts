import 'server-only'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createCheckResult } from '@/db/repositories/check-results'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import {
  type ReferenceFormView,
  findReferenceCheckRows,
  findReferenceCheckState,
  findReferenceFormView,
  findReferenceSubject,
  markReferenceRequested,
  recordReferenceResponse,
} from '@/db/repositories/reference-checks'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  REFERENCE_CHECK_RESULT_EVIDENCE_KEY,
  REFERENCE_DECISION_INSTANCE_STATUS,
  type ReferenceCheckDecisionRefusal,
  type ReferenceCheckRow,
  type ReferenceRequestRefusal,
  decideReferenceCheckRequestSchema,
  outstandingReferenceChecks,
  recordReferenceByPhoneSchema,
  referenceCheckDecisionRefusal,
  referenceCheckOutcome,
  referenceRequestRefusal,
  referenceRequestSchema,
  referenceResponseSchema,
} from '@/domain/requirements/reference-check'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { LinkUseCase } from '@/server/auth/link-token'
import { defineLinkUseCase } from '@/server/auth/link-token'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { REFERENCE_CHASE_JOB_TYPE } from './reference-jobs'

// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const listReferenceChecks: UseCase<Record<string, never>, readonly ReferenceCheckRow[]> = defineUseCase(
  'reference.list',
  async ({ principal }) => outstandingReferenceChecks(await findReferenceCheckRows(principal.agencyId)),
)

// The change was allowed for the status just read, so any refusal means a concurrent writer.
function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

type RequestReferenceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ReferenceRequestRefusal }

// A coordinator sends each request; nothing goes out automatically (OPEN-QUESTIONS 227).
export const requestReference: UseCase<{ readonly referenceId: string }, RequestReferenceResult> = defineUseCase(
  'reference.request',
  async ({ principal, input: raw }) => {
    const { referenceId } = referenceRequestSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<RequestReferenceResult> => {
      const subject = await findReferenceSubject(tx, agencyId, referenceId)
      if (subject === null) throw new Error(`Reference ${referenceId} does not exist in agency ${agencyId}.`)

      const refusal = referenceRequestRefusal({
        stage: subject.caregiverStage,
        requestStatus: subject.requestStatus,
        checkStatus: subject.check?.status ?? null,
        barred: subject.barred,
        hasContact: subject.hasContact,
      })
      if (refusal !== null || subject.check === null) return { ok: false, reason: refusal ?? 'NOT_OUTSTANDING' }
      if (!(await markReferenceRequested(tx, agencyId, referenceId))) return { ok: false, reason: 'ALREADY_REQUESTED' }

      if (subject.check.status === 'NOT_STARTED') {
        const { instanceId } = subject.check
        requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING'), instanceId)
      }
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: REFERENCE_CHASE_JOB_TYPE,
        payload: { referenceId },
        idempotencyKey: buildIdempotencyKey(REFERENCE_CHASE_JOB_TYPE, [referenceId]),
      })
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: subject.caregiverId,
        fieldName: 'references',
      })
      return { ok: true }
    })
  },
)

/**
 * Two favourable answers satisfy the check; any unfavourable one sends it to a person and never
 * fails anyone. Satisfying the last blocking requirement moves the caregiver to
 * Clearance (ADR-113). An IN_REVIEW check waits for a person, so later answers leave it there.
 */
async function settleReferenceCheck(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  actorUserId: string | null,
): Promise<void> {
  const state = await findReferenceCheckState(tx, agencyId, caregiverId)
  if (state === null || state.status !== 'PENDING') return

  const { instanceId } = state
  const outcome = referenceCheckOutcome(state.answers)
  if (outcome === 'PENDING') return
  if (outcome === 'IN_REVIEW') {
    requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'IN_REVIEW'), instanceId)
    return
  }

  await satisfyReferenceCheck(tx, agencyId, caregiverId, instanceId, actorUserId)
}

async function satisfyReferenceCheck(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  instanceId: string,
  actorUserId: string | null,
): Promise<void> {
  const checkResult = await createCheckResult(agencyId, caregiverId, actorUserId)
  const link = await linkEvidence(agencyId, instanceId, REFERENCE_CHECK_RESULT_EVIDENCE_KEY, {
    kind: 'CHECK_RESULT',
    checkResultId: checkResult.id,
  })
  if (!link.ok) {
    throw new Error(`Requirement instance ${instanceId} does not accept CHECK_RESULT ${REFERENCE_CHECK_RESULT_EVIDENCE_KEY}.`)
  }
  requireChanged(await changeRequirementInstanceStatus(agencyId, instanceId, 'SATISFIED'), instanceId)
  await applyVerificationCompleted(tx, agencyId, caregiverId, actorUserId)
  await writeAuditEntry(tx, {
    agencyId,
    action: 'EDIT',
    entityType: 'CAREGIVER',
    entityId: caregiverId,
    fieldName: 'checkResults',
  })
}

async function auditAnswer(tx: AuditedTx, agencyId: string, caregiverId: string): Promise<void> {
  await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'CAREGIVER', entityId: caregiverId, fieldName: 'references' })
}

// A caregiver may delete a reference whose link is still live, so null is not an error here.
export const viewReferenceForm: LinkUseCase<Record<string, never>, ReferenceFormView | null> = defineLinkUseCase(
  'REFERENCE_FORM',
  'inspect',
  ({ grant, tx }) => findReferenceFormView(tx, grant.agencyId, grant.referenceId),
)

/**
 * The action validates first, so a parse failure here is a programmer error and leaves the link
 * usable. CLOSED consumes the link: the request is over.
 */
export const submitReferenceResponse: LinkUseCase<Record<string, unknown>, 'RECORDED' | 'CLOSED'> = defineLinkUseCase(
  'REFERENCE_FORM',
  'consume',
  async ({ grant, input, tx }) => {
    const response = referenceResponseSchema.parse(input)
    const { agencyId, referenceId } = grant

    const subject = await findReferenceSubject(tx, agencyId, referenceId)
    if (subject === null || subject.caregiverStage === 'WITHDRAWN') return 'CLOSED'
    const recorded = await recordReferenceResponse(tx, agencyId, referenceId, {
      ...response,
      respondedAt: new Date(),
      recordedByUserId: null,
    })
    if (!recorded) return 'CLOSED'

    await auditAnswer(tx, agencyId, subject.caregiverId)
    await settleReferenceCheck(tx, agencyId, subject.caregiverId, null)
    return 'RECORDED'
  },
)

type RecordByPhoneResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'CAREGIVER_WITHDRAWN' | 'NOT_ESCALATED' }

export const recordReferenceByPhone: UseCase<
  { readonly referenceId: string } & Record<string, unknown>,
  RecordByPhoneResult
> = defineUseCase('reference.recordResponse', async ({ principal, input: raw }) => {
  const { referenceId, ...response } = recordReferenceByPhoneSchema.parse(raw)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx): Promise<RecordByPhoneResult> => {
    const subject = await findReferenceSubject(tx, agencyId, referenceId)
    if (subject === null) throw new Error(`Reference ${referenceId} does not exist in agency ${agencyId}.`)
    if (subject.caregiverStage === 'WITHDRAWN') return { ok: false, reason: 'CAREGIVER_WITHDRAWN' }
    if (subject.requestStatus !== 'ESCALATED') return { ok: false, reason: 'NOT_ESCALATED' }

    const recorded = await recordReferenceResponse(tx, agencyId, referenceId, {
      ...response,
      respondedAt: new Date(),
      recordedByUserId: principal.id,
    })
    if (!recorded) return { ok: false, reason: 'NOT_ESCALATED' }

    await auditAnswer(tx, agencyId, subject.caregiverId)
    await settleReferenceCheck(tx, agencyId, subject.caregiverId, principal.id)
    return { ok: true }
  })
})

type DecideReferenceCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ReferenceCheckDecisionRefusal }

/**
 * A person decides after reading the unfavourable answer. A fail blocks clearance but withdraws no
 * one; both decisions are final.
 */
export const decideReferenceCheck: UseCase<
  { readonly caregiverId: string; readonly decision: string },
  DecideReferenceCheckResult
> = defineUseCase('reference.decide', async ({ principal, input: raw }) => {
  const { caregiverId, decision } = decideReferenceCheckRequestSchema.parse(raw)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx): Promise<DecideReferenceCheckResult> => {
    const state = await findReferenceCheckState(tx, agencyId, caregiverId)
    if (state === null) throw new Error(`Caregiver ${caregiverId} has no reference check in agency ${agencyId}.`)

    const refusal = referenceCheckDecisionRefusal({
      stage: state.caregiverStage,
      status: state.status,
      answers: state.answers,
    })
    if (refusal !== null) return { ok: false, reason: refusal }

    if (decision === 'SATISFIED_AFTER_REVIEW') {
      await satisfyReferenceCheck(tx, agencyId, caregiverId, state.instanceId, principal.id)
    } else {
      requireChanged(
        await changeRequirementInstanceStatus(
          agencyId,
          state.instanceId,
          REFERENCE_DECISION_INSTANCE_STATUS.FAILED_AFTER_REVIEW,
        ),
        state.instanceId,
      )
    }
    await auditAnswer(tx, agencyId, caregiverId)
    return { ok: true }
  })
})
