import { addYears, max, subDays, subYears } from 'date-fns'
import type { EnvelopeStatus } from '@/domain/documents/envelope'

type RetentionPeriod = { readonly unit: 'days' | 'years'; readonly amount: number }

/** The fixed-age rules (SECURITY.md § Retention). I-9 and unsigned generated PDFs are anchored on events, below. */
const RETENTION_PERIODS = {
  NEVER_STARTED_APPLICANT: { unit: 'days', amount: 30 },
  BACKGROUND_CHECK_RESULT: { unit: 'years', amount: 7 },
  // A vendor's deliveries about an order follow the order (T-081).
  BACKGROUND_CHECK_WEBHOOK: { unit: 'years', amount: 7 },
  // OPEN-QUESTIONS 255.
  ESIGN_WEBHOOK: { unit: 'days', amount: 90 },
  // OPEN-QUESTIONS 252.
  AUDIT_LOG: { unit: 'years', amount: 7 },
} as const satisfies Record<string, RetentionPeriod>

/** Anything anchored strictly before the returned instant is past retention. */
export function retentionCutoff(rule: keyof typeof RETENTION_PERIODS, now: Date): Date {
  const period: RetentionPeriod = RETENTION_PERIODS[rule]
  return period.unit === 'days' ? subDays(now, period.amount) : subYears(now, period.amount)
}

/**
 * SECURITY.md: "deleted 30 days after invite expiry". The expiry is the latest INVITE token's;
 * a resend moves the anchor forward; an invite whose link was never issued is anchored at its
 * createdAt (T-130 § Risks 3).
 */
export function neverStartedApplicantDue(input: {
  readonly invitesCreatedAt: readonly Date[]
  readonly inviteTokens: readonly { readonly expiresAt: Date; readonly consumedAt: Date | null }[]
  readonly now: Date
}): boolean {
  const { invitesCreatedAt, inviteTokens, now } = input
  if (inviteTokens.some((token) => token.consumedAt === null && token.expiresAt > now)) return false

  const anchors = [...invitesCreatedAt, ...inviteTokens.map((token) => token.expiresAt)]
  if (anchors.length === 0) return false
  return max(anchors) <= retentionCutoff('NEVER_STARTED_APPLICANT', now)
}

type I9Retention =
  | { readonly kind: 'NOT_HIRED' }
  | { readonly kind: 'INDEFINITE' }
  | { readonly kind: 'UNTIL'; readonly until: Date }

/**
 * SECURITY.md: 3 years after hire or 1 year after termination, whichever is later. With no
 * termination recorded the later date is unknown, so the I-9 is kept (OPEN-QUESTIONS 254).
 */
export function i9Retention(input: {
  readonly hiredAt: Date | null
  readonly terminatedAt: Date | null
}): I9Retention {
  const { hiredAt, terminatedAt } = input
  if (hiredAt === null) return { kind: 'NOT_HIRED' }
  if (terminatedAt === null) return { kind: 'INDEFINITE' }
  return { kind: 'UNTIL', until: max([addYears(hiredAt, 3), addYears(terminatedAt, 1)]) }
}

/** ADR-069: an unsigned generated PDF is disposable once its envelope can no longer be signed. */
export const DISPOSABLE_ENVELOPE_STATUSES: readonly EnvelopeStatus[] = ['SIGNED', 'DECLINED', 'VOIDED']
