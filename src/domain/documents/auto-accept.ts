import type { IdentityOutcome } from '@/domain/identity/match'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { DocumentExtraction } from './extraction'
import type { ReviewOutcome } from './review-outcome'

// The source of truth for the Prisma enum AutoAcceptStaffReason; keep the two in step.
export const AUTO_ACCEPT_STAFF_REASONS = [
  'MANUAL_ONLY',
  'EXTRACTION_NOT_CONFIDENT',
  'IDENTITY_NOT_MATCHED',
  'JUDGE_NOT_RUN',
  'JUDGE_NOT_PASSED',
] as const
export type AutoAcceptStaffReason = (typeof AUTO_ACCEPT_STAFF_REASONS)[number]

export type AutoAcceptDecision = {
  readonly uploadedDocumentId: string
  readonly outcome: ReviewOutcome
  readonly identity: { readonly fullName: IdentityOutcome; readonly dateOfBirth: IdentityOutcome }
  // What this decision moved the requirement instance to; null when it moved nothing.
  readonly instanceStatusSet: InstanceStatus | null
  readonly decidedAt: Date
}

// OPEN-QUESTIONS 163.
const EXTRACTION_MIN_CONFIDENCE = 0.9

// The fields a decision relies on: name and DOB feed identity matching, which ignores confidence,
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
