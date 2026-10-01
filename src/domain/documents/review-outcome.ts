import type { IdentityMatch, IdentityOutcome } from '@/domain/identity/match'
import { satisfactionPath } from '@/domain/requirements/manual-only'
import type { RequirementTemplate } from '@/domain/requirements/template'
import { AUTO_ACCEPT_STAFF_REASONS, type AutoAcceptStaffReason, unconfidentReadings } from './auto-accept'
import type { DocumentExtraction } from './extraction'
import type { JudgeStepOutcome } from './judge-review'

export const RETURN_REASONS = ['UNREADABLE', 'EXPIRED', 'NAME_NOT_FOUND', 'DOB_DIFFERS'] as const

export type ReturnReason = (typeof RETURN_REASONS)[number]

export type ReviewOutcome =
  | { readonly kind: 'RETURN'; readonly reason: ReturnReason }
  | { readonly kind: 'STAFF'; readonly reasons: readonly AutoAcceptStaffReason[] }

type ReviewInput = {
  readonly requirement: Pick<RequirementTemplate, 'manualOnly' | 'manualOnlyReason'>
  readonly extraction: Pick<DocumentExtraction, 'confidence' | 'fields'>
  readonly identity: IdentityMatch
  readonly judge: JudgeStepOutcome | null
}

// OPEN-QUESTIONS 260.
const READABLE_MIN_CONFIDENCE = 0.5

function identityOutcome(identity: IdentityMatch, field: 'fullName' | 'dateOfBirth'): IdentityOutcome | undefined {
  return identity.findings.find((finding) => finding.field === field)?.outcome
}

function returnReason({ extraction, identity, judge }: ReviewInput): ReturnReason | null {
  if (extraction.confidence < READABLE_MIN_CONFIDENCE) return 'UNREADABLE'
  if (judge?.kind === 'STAFF' && judge.reasons.includes('EXPIRED')) return 'EXPIRED'
  const fullName = identityOutcome(identity, 'fullName')
  if (fullName === 'DIFFERS' || fullName === 'UNREADABLE' || fullName === 'NOT_PRINTED') return 'NAME_NOT_FOUND'
  if (identityOutcome(identity, 'dateOfBirth') === 'DIFFERS') return 'DOB_DIFFERS'
  return null
}

/**
 * Never accepts: only a staff approval satisfies a document (ADR-164). A failure the caregiver can
 * fix returns it to them; anything else goes to staff with what failed, possibly nothing.
 */
export function reviewOutcome(input: ReviewInput): ReviewOutcome {
  const reason = returnReason(input)
  if (reason !== null) return { kind: 'RETURN', reason }

  const { requirement, extraction, identity, judge } = input
  const reasons = new Set<AutoAcceptStaffReason>()
  // Checked here as well as in the judge step: a regulated requirement stays with staff even if
  // another step forgets it.
  if (satisfactionPath(requirement).kind === 'MANUAL_ONLY') reasons.add('MANUAL_ONLY')
  if (unconfidentReadings(extraction).length > 0) reasons.add('EXTRACTION_NOT_CONFIDENT')
  if (!identity.matched) reasons.add('IDENTITY_NOT_MATCHED')
  if (judge === null) reasons.add('JUDGE_NOT_RUN')
  else if (judge.kind === 'STAFF') reasons.add('JUDGE_NOT_PASSED')
  return { kind: 'STAFF', reasons: AUTO_ACCEPT_STAFF_REASONS.filter((staffReason) => reasons.has(staffReason)) }
}
