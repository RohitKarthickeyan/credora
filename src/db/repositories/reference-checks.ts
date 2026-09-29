import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import {
  type AttemptLogEntry,
  REFERENCE_CHECK_REQUIREMENT_KEY,
  type ReferenceAnswer,
  type ReferenceCheckRow,
  type ReferenceRequestStatus,
  type ReferenceResponse,
  contactBarred,
} from '@/domain/requirements/reference-check'
import { type AuditedTx, runInAuditedTransaction } from '../audit'

// IdentityRecord is sensitive-tier: only the two plaintext name columns are selected.
const CAREGIVER_NAME_SELECT = { identity: { select: { legalFirstName: true, legalLastName: true } } } as const

function caregiverName(
  identity: { readonly legalFirstName: string | null; readonly legalLastName: string | null } | null,
): string | null {
  const parts = [identity?.legalFirstName ?? null, identity?.legalLastName ?? null].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
}

const EMPLOYMENT_RULE_SELECT = { employerName: true, supervisorPhone: true, mayContact: true } as const
const CHECK_INSTANCE_SELECT = {
  where: { templateKey: REFERENCE_CHECK_REQUIREMENT_KEY },
  select: { id: true, status: true },
} as const

export function findReferenceCheckRows(agencyId: string): Promise<readonly ReferenceCheckRow[]> {
  return runInAuditedTransaction(async (tx) => {
    const caregivers = await tx.caregiver.findMany({
      where: {
        agencyId,
        stage: { not: 'WITHDRAWN' },
        requirementInstances: { some: { templateKey: REFERENCE_CHECK_REQUIREMENT_KEY } },
      },
      select: {
        id: true,
        ...CAREGIVER_NAME_SELECT,
        employment: { select: EMPLOYMENT_RULE_SELECT },
        requirementInstances: CHECK_INSTANCE_SELECT,
        references: {
          select: {
            id: true,
            fullName: true,
            relationship: true,
            employerName: true,
            phone: true,
            email: true,
            requestStatus: true,
            workedWith: true,
            wouldRecommend: true,
            responseComments: true,
            responseRecordedByUserId: true,
            attempts: { select: { number: true, status: true, sentAt: true }, orderBy: { number: 'asc' } },
          },
        },
      },
    })

    return caregivers.flatMap((caregiver) => {
      const check = caregiver.requirementInstances[0]
      if (check === undefined) return []
      const name = caregiverName(caregiver.identity)
      return caregiver.references.map(
        (reference): ReferenceCheckRow => ({
          referenceId: reference.id,
          caregiverId: caregiver.id,
          caregiverName: name,
          referenceName: reference.fullName,
          relationship: reference.relationship,
          employerName: reference.employerName,
          phone: reference.phone,
          email: reference.email,
          requestStatus: reference.requestStatus,
          barred: contactBarred(reference, caregiver.employment),
          checkStatus: check.status,
          attempts: reference.attempts,
          answer:
            reference.requestStatus === 'RESPONDED' &&
            reference.workedWith !== null &&
            reference.wouldRecommend !== null
              ? {
                  workedWith: reference.workedWith,
                  wouldRecommend: reference.wouldRecommend,
                  comments: reference.responseComments,
                  byPhone: reference.responseRecordedByUserId !== null,
                }
              : null,
        }),
      )
    })
  })
}

type ReferenceSubject = {
  readonly referenceId: string
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly requestStatus: ReferenceRequestStatus
  readonly barred: boolean
  readonly hasContact: boolean
  readonly check: { readonly instanceId: string; readonly status: InstanceStatus } | null
}

export async function findReferenceSubject(
  tx: AuditedTx,
  agencyId: string,
  referenceId: string,
): Promise<ReferenceSubject | null> {
  const reference = await tx.reference.findFirst({
    where: { agencyId, id: referenceId },
    select: {
      caregiverId: true,
      employerName: true,
      phone: true,
      email: true,
      requestStatus: true,
      caregiver: {
        select: {
          stage: true,
          employment: { select: EMPLOYMENT_RULE_SELECT },
          requirementInstances: CHECK_INSTANCE_SELECT,
        },
      },
    },
  })
  if (reference === null) return null

  const check = reference.caregiver.requirementInstances[0]
  return {
    referenceId,
    caregiverId: reference.caregiverId,
    caregiverStage: reference.caregiver.stage,
    requestStatus: reference.requestStatus,
    barred: contactBarred(reference, reference.caregiver.employment),
    hasContact: reference.phone !== null || reference.email !== null,
    check: check === undefined ? null : { instanceId: check.id, status: check.status },
  }
}

export async function markReferenceRequested(tx: AuditedTx, agencyId: string, referenceId: string): Promise<boolean> {
  const { count } = await tx.reference.updateMany({
    where: { agencyId, id: referenceId, requestStatus: 'NOT_REQUESTED' },
    data: { requestStatus: 'REQUESTED' },
  })
  return count === 1
}

export type ReferenceChase = {
  readonly referenceId: string
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly caregiverName: string | null
  readonly agencyName: string
  readonly email: string | null
  readonly requestStatus: ReferenceRequestStatus
  readonly checkStatus: InstanceStatus | null
  /** Ascending by number. */
  readonly attempts: readonly AttemptLogEntry[]
}

export function findReferenceChase(agencyId: string, referenceId: string): Promise<ReferenceChase | null> {
  return runInAuditedTransaction(async (tx) => {
    const reference = await tx.reference.findFirst({
      where: { agencyId, id: referenceId },
      select: {
        caregiverId: true,
        email: true,
        requestStatus: true,
        attempts: { select: { id: true, number: true, status: true, sentAt: true }, orderBy: { number: 'asc' } },
        caregiver: {
          select: {
            stage: true,
            ...CAREGIVER_NAME_SELECT,
            agency: { select: { name: true } },
            requirementInstances: CHECK_INSTANCE_SELECT,
          },
        },
      },
    })
    if (reference === null) return null

    return {
      referenceId,
      caregiverId: reference.caregiverId,
      caregiverStage: reference.caregiver.stage,
      caregiverName: caregiverName(reference.caregiver.identity),
      agencyName: reference.caregiver.agency.name,
      email: reference.email,
      requestStatus: reference.requestStatus,
      checkStatus: reference.caregiver.requirementInstances[0]?.status ?? null,
      attempts: reference.attempts,
    }
  })
}

/** Resumes attempt `number` when it is still QUEUED, so a retried send never logs a second row. */
export async function startReferenceAttempt(
  tx: AuditedTx,
  agencyId: string,
  referenceId: string,
  number: number,
): Promise<{ readonly id: string }> {
  const queued = await tx.referenceAttempt.findFirst({
    where: { agencyId, referenceId, number, status: 'QUEUED' },
    select: { id: true },
  })
  if (queued !== null) return queued
  return tx.referenceAttempt.create({ data: { agencyId, referenceId, number }, select: { id: true } })
}

export async function recordReferenceAttemptOutcome(
  tx: AuditedTx,
  agencyId: string,
  attemptId: string,
  outcome:
    | { readonly status: 'SENT'; readonly sentAt: Date }
    | { readonly status: 'REJECTED'; readonly reason: string },
): Promise<void> {
  await tx.referenceAttempt.updateMany({
    where: { agencyId, id: attemptId, status: 'QUEUED' },
    data:
      outcome.status === 'SENT'
        ? { status: 'SENT', sentAt: outcome.sentAt }
        : { status: 'REJECTED', rejectedReason: outcome.reason },
  })
}

export async function markReferenceAttemptUnanswered(tx: AuditedTx, agencyId: string, attemptId: string): Promise<void> {
  await tx.referenceAttempt.updateMany({
    where: { agencyId, id: attemptId, status: 'SENT' },
    data: { status: 'UNANSWERED' },
  })
}

export async function escalateReference(
  tx: AuditedTx,
  agencyId: string,
  referenceId: string,
  now: Date,
): Promise<boolean> {
  const { count } = await tx.reference.updateMany({
    where: { agencyId, id: referenceId, requestStatus: 'REQUESTED' },
    data: { requestStatus: 'ESCALATED', escalatedAt: now },
  })
  return count === 1
}

export type ReferenceFormView = {
  readonly agencyName: string
  readonly caregiverName: string | null
  readonly referenceName: string
  readonly open: boolean
}

export async function findReferenceFormView(
  tx: AuditedTx,
  agencyId: string,
  referenceId: string,
): Promise<ReferenceFormView | null> {
  const reference = await tx.reference.findFirst({
    where: { agencyId, id: referenceId },
    select: {
      fullName: true,
      requestStatus: true,
      caregiver: { select: { stage: true, ...CAREGIVER_NAME_SELECT, agency: { select: { name: true } } } },
    },
  })
  if (reference === null) return null

  return {
    agencyName: reference.caregiver.agency.name,
    caregiverName: caregiverName(reference.caregiver.identity),
    referenceName: reference.fullName,
    open:
      (reference.requestStatus === 'REQUESTED' || reference.requestStatus === 'ESCALATED') &&
      reference.caregiver.stage !== 'WITHDRAWN',
  }
}

// ESCALATED is accepted on purpose: a late answer from the form is still useful.
export async function recordReferenceResponse(
  tx: AuditedTx,
  agencyId: string,
  referenceId: string,
  response: ReferenceResponse & { readonly respondedAt: Date; readonly recordedByUserId: string | null },
): Promise<boolean> {
  const { count } = await tx.reference.updateMany({
    where: { agencyId, id: referenceId, requestStatus: { in: ['REQUESTED', 'ESCALATED'] } },
    data: {
      requestStatus: 'RESPONDED',
      respondedAt: response.respondedAt,
      workedWith: response.workedWith,
      wouldRecommend: response.wouldRecommend,
      responseComments: response.comments,
      responseRecordedByUserId: response.recordedByUserId,
    },
  })
  return count === 1
}

type ReferenceCheckState = {
  readonly instanceId: string
  readonly status: InstanceStatus
  readonly answers: readonly ReferenceAnswer[]
  readonly caregiverStage: PipelineStage
}

export async function findReferenceCheckState(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<ReferenceCheckState | null> {
  const instance = await tx.requirementInstance.findFirst({
    where: { agencyId, caregiverId, templateKey: REFERENCE_CHECK_REQUIREMENT_KEY },
    select: { id: true, status: true, caregiver: { select: { stage: true } } },
  })
  if (instance === null) return null

  const responded = await tx.reference.findMany({
    where: { agencyId, caregiverId, requestStatus: 'RESPONDED' },
    select: { workedWith: true, wouldRecommend: true },
  })
  return {
    instanceId: instance.id,
    status: instance.status,
    answers: responded.flatMap(({ workedWith, wouldRecommend }) =>
      workedWith === null || wouldRecommend === null ? [] : [{ workedWith, wouldRecommend }],
    ),
    caregiverStage: instance.caregiver.stage,
  }
}
