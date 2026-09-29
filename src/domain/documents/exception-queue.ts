import type { AutoAcceptDecision, UnconfidentReading } from './auto-accept'
import type { JudgeDecision } from './judge-review'
import type { CaregiverNoticeStatus, ReturnDecision } from './staff-decision'

export type QueueDocument = {
  readonly uploadedDocumentId: string
  readonly instanceId: string
  readonly templateKey: string
  readonly requirementName: string
  readonly caregiverId: string
  readonly caregiverName: string | null
}

export type JudgeReasoning =
  | { readonly kind: 'SHOWN'; readonly reasons: readonly string[] }
  // A clinic result's reasons are kept in the medical store and not read here (ADR-105).
  | { readonly kind: 'CLINICAL' }

export type FlaggedDocument = QueueDocument & {
  readonly flaggedAt: Date
  readonly autoAccept: AutoAcceptDecision
  readonly unconfidentReadings: readonly UnconfidentReading[]
  // null: the judge step never ran (JUDGE_NOT_RUN).
  readonly judge: JudgeDecision | null
  readonly judgeReasoning: JudgeReasoning
  readonly returned: ReturnedToCaregiver | null
}

export type ReturnedToCaregiver = {
  readonly staffDecisionId: string
  readonly decision: ReturnDecision
  readonly decidedAt: Date
  readonly notice: CaregiverNoticeStatus
  // A DEAD review.caregiverNotice job for it, which staff retry.
  readonly stoppedNoticeJobId: string | null
}

export type ReviewStep = 'EXTRACTION' | 'JUDGE' | 'AUTO_ACCEPT'

export type StalledReview = QueueDocument & {
  readonly jobId: string
  readonly step: ReviewStep
  readonly attempts: number
  readonly stoppedAt: Date | null
}

export type SigningStep = 'SEND' | 'RECORD'

export type StalledSigning = {
  readonly jobId: string
  readonly step: SigningStep
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly attempts: number
  readonly stoppedAt: Date | null
}

export type ExceptionQueue = {
  readonly flagged: readonly FlaggedDocument[]
  readonly stalled: readonly StalledReview[]
  readonly stalledSigning: readonly StalledSigning[]
}

type Flagging = { readonly instanceId: string; readonly uploadedDocumentId: string; readonly flaggedAt: Date }

function later(a: Flagging, b: Flagging): boolean {
  const diff = a.flaggedAt.getTime() - b.flaggedAt.getTime()
  return diff !== 0 ? diff > 0 : a.uploadedDocumentId > b.uploadedDocumentId
}

/** One row per instance — its latest flagging — longest waiting first (§ Design 1). */
export function selectFlaggedDocuments<T extends Flagging>(rows: readonly T[]): readonly T[] {
  const latest = new Map<string, T>()
  for (const row of rows) {
    const current = latest.get(row.instanceId)
    if (current === undefined || later(row, current)) latest.set(row.instanceId, row)
  }
  return [...latest.values()].sort((a, b) => {
    const diff = a.flaggedAt.getTime() - b.flaggedAt.getTime()
    if (diff !== 0) return diff
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0
  })
}
