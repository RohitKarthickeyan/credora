import { addHours } from 'date-fns'
import { z } from 'zod'
import type { PipelineStage } from '../pipeline/stage'
import type { InstanceStatus } from './instance-status'
import { compareNames } from './manual-check'

export const REFERENCE_CHECK_REQUIREMENT_KEY = 'REFERENCE_CHECK'
export const REFERENCE_CHECK_RESULT_EVIDENCE_KEY = 'REFERENCE_CHECK_RESULT'
export const REFERENCE_MINIMUM = 2
// PRD § 5: escalate after two misses.
export const REFERENCE_ATTEMPT_LIMIT = 2
// Product-owner default in force (OPEN-QUESTIONS 228).
export const REFERENCE_RESPONSE_WINDOW_HOURS = 72

// The Prisma enums ReferenceRequestStatus and ReferenceAttemptStatus mirror these lists;
// keep them in step.
export const REFERENCE_REQUEST_STATUSES = ['NOT_REQUESTED', 'REQUESTED', 'RESPONDED', 'ESCALATED'] as const
export type ReferenceRequestStatus = (typeof REFERENCE_REQUEST_STATUSES)[number]
export const REFERENCE_ATTEMPT_STATUSES = ['QUEUED', 'SENT', 'REJECTED', 'UNANSWERED'] as const
export type ReferenceAttemptStatus = (typeof REFERENCE_ATTEMPT_STATUSES)[number]


type EmploymentContactRule = {
  readonly employerName: string
  readonly supervisorPhone: string | null
  readonly mayContact: boolean
}

function normaliseEmployer(name: string | null): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// The caregiver's "May we contact this employer? No" covers a reference at the same employer or
// on that employer's supervisor phone (OPEN-QUESTIONS 232).
export function contactBarred(
  reference: { readonly employerName: string | null; readonly phone: string | null },
  employment: readonly EmploymentContactRule[],
): boolean {
  const employer = normaliseEmployer(reference.employerName)
  return employment.some(
    (entry) =>
      !entry.mayContact &&
      ((employer !== '' && employer === normaliseEmployer(entry.employerName)) ||
        (reference.phone !== null && reference.phone === entry.supervisorPhone)),
  )
}

export type AttemptLogEntry = {
  readonly id: string
  readonly number: number
  readonly status: ReferenceAttemptStatus
  readonly sentAt: Date | null
}

type ChaseStep = {
  /** The latest attempt, SENT and past its window, that this step records as UNANSWERED. */
  readonly unanswered: string | null
  readonly next:
    | { readonly kind: 'SEND'; readonly number: number }
    | { readonly kind: 'WAIT' }
    | { readonly kind: 'ESCALATE' }
}

// Decided from the attempt log, never from a count of runs: the scheduler skips missed
// occurrences and a job can be retried. A rejection is a miss at once.
export function nextChaseStep(attempts: readonly AttemptLogEntry[], now: Date): ChaseStep {
  const latest = attempts.reduce<AttemptLogEntry | null>(
    (found, attempt) => (found === null || attempt.number > found.number ? attempt : found),
    null,
  )
  if (latest === null) return { unanswered: null, next: { kind: 'SEND', number: 1 } }
  if (latest.status === 'QUEUED') return { unanswered: null, next: { kind: 'SEND', number: latest.number } }

  let unanswered: string | null = null
  if (latest.status === 'SENT') {
    if (latest.sentAt === null) throw new Error(`Reference attempt ${latest.id} is SENT with no sentAt.`)
    if (now < addHours(latest.sentAt, REFERENCE_RESPONSE_WINDOW_HOURS)) {
      return { unanswered: null, next: { kind: 'WAIT' } }
    }
    unanswered = latest.id
  }

  return {
    unanswered,
    next:
      latest.number < REFERENCE_ATTEMPT_LIMIT
        ? { kind: 'SEND', number: latest.number + 1 }
        : { kind: 'ESCALATE' },
  }
}

export type ReferenceAnswer = { readonly workedWith: boolean; readonly wouldRecommend: boolean }
type ReferenceCheckOutcome = 'PENDING' | 'SATISFIED' | 'IN_REVIEW'

// Any "no" goes to a person and outranks the favourable count: a rules engine does not reject
// someone on a third party's word, and a supervisor must read it before clearance.
export function isUnfavourable(answer: ReferenceAnswer): boolean {
  return !answer.workedWith || !answer.wouldRecommend
}

export function referenceCheckOutcome(answers: readonly ReferenceAnswer[]): ReferenceCheckOutcome {
  if (answers.some(isUnfavourable)) return 'IN_REVIEW'
  return answers.length >= REFERENCE_MINIMUM ? 'SATISFIED' : 'PENDING'
}

export type ReferenceRequestRefusal =
  | 'CAREGIVER_WITHDRAWN'
  | 'ALREADY_REQUESTED'
  | 'NOT_OUTSTANDING'
  | 'DO_NOT_CONTACT'
  | 'NO_CONTACT_DETAILS'

export function referenceRequestRefusal(input: {
  readonly stage: PipelineStage
  readonly requestStatus: ReferenceRequestStatus
  readonly checkStatus: InstanceStatus | null
  readonly barred: boolean
  readonly hasContact: boolean
}): ReferenceRequestRefusal | null {
  if (input.stage === 'WITHDRAWN') return 'CAREGIVER_WITHDRAWN'
  if (input.requestStatus !== 'NOT_REQUESTED') return 'ALREADY_REQUESTED'
  if (input.checkStatus !== 'NOT_STARTED' && input.checkStatus !== 'PENDING') return 'NOT_OUTSTANDING'
  if (input.barred) return 'DO_NOT_CONTACT'
  if (!input.hasContact) return 'NO_CONTACT_DETAILS'
  return null
}

const REFERENCE_CHECK_DECISIONS = ['SATISFIED_AFTER_REVIEW', 'FAILED_AFTER_REVIEW'] as const
export type ReferenceCheckDecision = (typeof REFERENCE_CHECK_DECISIONS)[number]

export const REFERENCE_DECISION_INSTANCE_STATUS = {
  SATISFIED_AFTER_REVIEW: 'SATISFIED',
  FAILED_AFTER_REVIEW: 'EXCEPTION',
} as const satisfies Record<ReferenceCheckDecision, InstanceStatus>

export type ReferenceCheckDecisionRefusal = 'CAREGIVER_WITHDRAWN' | 'NOT_AWAITING_REVIEW'

// IN_REVIEW alone does not prove an unfavourable answer; that answer is what the decision is about.
// A decision is final (OPEN-QUESTIONS 243), so a decided check is no longer awaiting review.
export function referenceCheckDecisionRefusal(input: {
  readonly stage: PipelineStage
  readonly status: InstanceStatus
  readonly answers: readonly ReferenceAnswer[]
}): ReferenceCheckDecisionRefusal | null {
  if (input.stage === 'WITHDRAWN') return 'CAREGIVER_WITHDRAWN'
  if (input.status !== 'IN_REVIEW' || !input.answers.some(isUnfavourable)) return 'NOT_AWAITING_REVIEW'
  return null
}

export const decideReferenceCheckRequestSchema = z.strictObject({
  caregiverId: z.string().min(1),
  decision: z.enum(REFERENCE_CHECK_DECISIONS),
})

const yesNo = z.enum(['yes', 'no']).transform((value) => value === 'yes')

// The questions and what counts as favourable are the default in force (OPEN-QUESTIONS 230).
export const referenceResponseSchema = z.strictObject({
  workedWith: yesNo,
  wouldRecommend: yesNo,
  comments: z
    .string()
    .trim()
    .max(500)
    .default('')
    .transform((value) => (value === '' ? null : value)),
})
export type ReferenceResponse = z.infer<typeof referenceResponseSchema>

export const referenceRequestSchema = z.strictObject({ referenceId: z.string().min(1) })

export const recordReferenceByPhoneSchema = referenceResponseSchema.extend({
  referenceId: z.string().min(1),
})

export type ReferenceCheckRow = {
  readonly referenceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly referenceName: string
  readonly relationship: string | null
  readonly employerName: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly requestStatus: ReferenceRequestStatus
  readonly barred: boolean
  readonly checkStatus: InstanceStatus
  readonly attempts: readonly {
    readonly number: number
    readonly status: ReferenceAttemptStatus
    readonly sentAt: Date | null
  }[]
  readonly answer: (ReferenceAnswer & { readonly comments: string | null; readonly byPhone: boolean }) | null
}

export function outstandingReferenceChecks(rows: readonly ReferenceCheckRow[]): readonly ReferenceCheckRow[] {
  return rows
    .filter((row) => row.checkStatus !== 'SATISFIED' && row.checkStatus !== 'WAIVED')
    .sort(
      (a, b) =>
        compareNames(a.caregiverName, b.caregiverName) ||
        a.referenceName.localeCompare(b.referenceName) ||
        a.referenceId.localeCompare(b.referenceId),
    )
}
