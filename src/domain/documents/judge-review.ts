import { satisfactionPath } from '@/domain/requirements/manual-only'
import type { RequirementTemplate } from '@/domain/requirements/template'
import { expiryFor } from '@/domain/requirements/validity'
import type { NormalisedFields } from './extraction'

// Sources of truth for the Prisma enums JudgeVerdict and JudgeStaffReason; JUDGE_VERDICTS also
// copies the judge port's verdicts, which src/domain may not import. Keep all of them in
// step.
export const JUDGE_VERDICTS = ['VALID', 'INVALID', 'UNCERTAIN'] as const
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number]

export const JUDGE_STAFF_REASONS = [
  'MANUAL_ONLY',
  'EXPIRED',
  'EXPIRY_UNKNOWN',
  'ISSUED_IN_FUTURE',
  'ISSUED_AFTER_EXPIRY',
  'VERDICT_INVALID',
  'VERDICT_UNCERTAIN',
  'LOW_JUDGE_CONFIDENCE',
  'MOCK_VERDICT_WITHOUT_ALLOWLIST',
] as const
export type JudgeStaffReason = (typeof JUDGE_STAFF_REASONS)[number]

// OPEN-QUESTIONS 156.
const ISSUER_MIN_CONFIDENCE = 0.9
const JUDGE_MIN_CONFIDENCE = 0.8

// The mock's issuer rule matches ordinary words, so its VALID is never evidence of a legitimate
// issuer (T-054 REVIEW, ADR-097).
const MOCK_JUDGE_MODEL_VERSION = 'mock'

export type JudgeBasis =
  | { readonly kind: 'ALLOWLISTED'; readonly issuer: { readonly id: string; readonly name: string } }
  | {
      readonly kind: 'JUDGED'
      readonly inputHash: string
      readonly verdict: JudgeVerdict
      readonly confidence: number
      readonly modelVersion: string
    }

// PASS means only that the judge step passes; it never accepts on its own (AGENTIC-TASKS.md).
export type JudgeStepOutcome =
  | { readonly kind: 'PASS' }
  | { readonly kind: 'STAFF'; readonly reasons: readonly JudgeStaffReason[] }

export type JudgeRequirement = Pick<
  RequirementTemplate,
  'description' | 'manualOnly' | 'manualOnlyReason' | 'validityRule' | 'validityMonths'
>

export type JudgeDecision = {
  readonly uploadedDocumentId: string
  readonly basis: JudgeBasis
  readonly outcome: JudgeStepOutcome
  readonly decidedAt: Date
}

/** The issuer as read, only when it was read confidently enough to look up in the allowlist. */
export function allowlistIssuerText(fields: NormalisedFields): string | null {
  const issuer = fields.issuer
  if (issuer === undefined || issuer.value === null || issuer.confidence < ISSUER_MIN_CONFIDENCE) {
    return null
  }
  return issuer.value
}

// YYYY-MM-DD strings order correctly as strings, so no Date is built here.
export function judgeStepOutcome(input: {
  readonly requirement: JudgeRequirement
  readonly fields: NormalisedFields
  readonly today: string
  readonly basis: JudgeBasis
}): JudgeStepOutcome {
  const { requirement, fields, today, basis } = input
  const reasons = new Set<JudgeStaffReason>()

  const path = satisfactionPath(requirement)
  switch (path.kind) {
    case 'MANUAL_ONLY':
      reasons.add('MANUAL_ONLY')
      break
    case 'AUTOMATED_ALLOWED':
      break
  }

  const issuedOn = fields.issueDate?.value ?? fields.completionDate?.value ?? null
  const printedExpiry = fields.expiryDate?.value ?? null
  const expiry = expiryFor(requirement, { issuedOn, evidenceExpiresOn: printedExpiry })
  if (issuedOn !== null && issuedOn > today) reasons.add('ISSUED_IN_FUTURE')
  if (issuedOn !== null && printedExpiry !== null && issuedOn > printedExpiry) {
    reasons.add('ISSUED_AFTER_EXPIRY')
  }
  if (expiry.kind === 'UNKNOWN') reasons.add('EXPIRY_UNKNOWN')
  // Valid through its expiry day.
  if (expiry.kind === 'ON' && expiry.date < today) reasons.add('EXPIRED')

  if (basis.kind === 'JUDGED') {
    if (basis.verdict === 'INVALID') reasons.add('VERDICT_INVALID')
    if (basis.verdict === 'UNCERTAIN') reasons.add('VERDICT_UNCERTAIN')
    if (basis.verdict === 'VALID' && basis.confidence < JUDGE_MIN_CONFIDENCE) {
      reasons.add('LOW_JUDGE_CONFIDENCE')
    }
    if (basis.modelVersion === MOCK_JUDGE_MODEL_VERSION) reasons.add('MOCK_VERDICT_WITHOUT_ALLOWLIST')
  }

  const ordered = JUDGE_STAFF_REASONS.filter((reason) => reasons.has(reason))
  return ordered.length === 0 ? { kind: 'PASS' } : { kind: 'STAFF', reasons: ordered }
}
