import type { IdentityMatch, IdentityOutcome } from '@/domain/identity/match'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { satisfactionPath } from '@/domain/requirements/manual-only'
import type { RequirementTemplate } from '@/domain/requirements/template'
import type { DocumentExtraction } from './extraction'
import type { JudgeStepOutcome } from './judge-review'

// The source of truth for the Prisma enum AutoAcceptStaffReason; keep the two in step.
const AUTO_ACCEPT_STAFF_REASONS = [
  'MANUAL_ONLY',
  'EXTRACTION_NOT_CONFIDENT',
  'IDENTITY_NOT_MATCHED',
  'JUDGE_NOT_RUN',
  'JUDGE_NOT_PASSED',
] as const
export type AutoAcceptStaffReason = (typeof AUTO_ACCEPT_STAFF_REASONS)[number]

export type AutoAcceptOutcome =
  | { readonly kind: 'ACCEPT' }
  | { readonly kind: 'STAFF'; readonly reasons: readonly AutoAcceptStaffReason[] }

export type AutoAcceptDecision = {
  readonly uploadedDocumentId: string
  readonly outcome: AutoAcceptOutcome
  readonly identity: { readonly fullName: IdentityOutcome; readonly dateOfBirth: IdentityOutcome }
  // What this decision moved the requirement instance to; null when it moved nothing.
  readonly instanceStatusSet: InstanceStatus | null
  readonly decidedAt: Date
}

// OPEN-QUESTIONS 163.
const EXTRACTION_MIN_CONFIDENCE = 0.9

// The fields an accept relies on: name and DOB feed identity matching, which ignores confidence,
// and the dates feed the judge step's rules, which treat only a null value as absent (ADR-102).
const RELIED_ON_FIELDS = ['fullName', 'dateOfBirth', 'issueDate', 'completionDate', 'expiryDate'] as const

export type UnconfidentReading = 'OVERALL' | (typeof RELIED_ON_FIELDS)[number]

/** Why a reading is not confident (ADR-102): empty exactly when it is. OVERALL first, then RELIED_ON_FIELDS order. */
export function unconfidentReadings(
  extraction: Pick<DocumentExtraction, 'confidence' | 'fields'>,
): readonly UnconfidentReading[] {
  const fields = RELIED_ON_FIELDS.filter((name) => {
    const field = extraction.fields[name]
    return field !== undefined && (field.value === null || field.confidence < EXTRACTION_MIN_CONFIDENCE)
  })
  return extraction.confidence < EXTRACTION_MIN_CONFIDENCE ? ['OVERALL', ...fields] : fields
}

/** Accepts only when every input passes; no single input can accept on its own (AGENTIC-TASKS.md). */
export function autoAcceptOutcome(input: {
  readonly requirement: Pick<RequirementTemplate, 'manualOnly' | 'manualOnlyReason'>
  readonly extraction: Pick<DocumentExtraction, 'confidence' | 'fields'>
  readonly identity: IdentityMatch
  readonly judge: JudgeStepOutcome | null
}): AutoAcceptOutcome {
  const { requirement, extraction, identity, judge } = input
  const reasons = new Set<AutoAcceptStaffReason>()

  // Checked here as well as in the judge step: a regulated requirement stays with staff even if
  // another step forgets it.
  const path = satisfactionPath(requirement)
  switch (path.kind) {
    case 'MANUAL_ONLY':
      reasons.add('MANUAL_ONLY')
      break
    case 'AUTOMATED_ALLOWED':
      break
  }

  if (unconfidentReadings(extraction).length > 0) reasons.add('EXTRACTION_NOT_CONFIDENT')
  if (!identity.matched) reasons.add('IDENTITY_NOT_MATCHED')
  if (judge === null) reasons.add('JUDGE_NOT_RUN')
  else if (judge.kind === 'STAFF') reasons.add('JUDGE_NOT_PASSED')

  const ordered = AUTO_ACCEPT_STAFF_REASONS.filter((reason) => reasons.has(reason))
  return ordered.length === 0 ? { kind: 'ACCEPT' } : { kind: 'STAFF', reasons: ordered }
}
