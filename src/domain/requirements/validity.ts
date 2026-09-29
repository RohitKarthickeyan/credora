import { addMonths, format, parseISO } from 'date-fns'
import { z } from 'zod'
import type { RequirementTemplate } from './template'

/**
 * `UNKNOWN` is a separate arm from `NEVER` on purpose: a FIXED_PERIOD requirement whose
 * evidence carries no issue date has an expiry nobody knows, and collapsing that into "never
 * expires" would clear a caregiver on an undated document.
 */
export type Expiry =
  | { readonly kind: 'NEVER' }
  | { readonly kind: 'ON'; readonly date: string }
  | { readonly kind: 'UNKNOWN' }

// Encodes month lengths and the full Gregorian leap rule, so 2026-02-29 is rejected here and
// no date-fns calendar check is needed.
const dateOnlySchema = z.iso.date()

// Both parseISO and format work in local time, so a YYYY-MM-DD in is local midnight and the
// same local day out. Mixing either with a UTC instant is what shifts an expiry by a day
// (CONVENTIONS.md § Code).
function parseDateOnly(value: string, field: string): Date {
  const parsed = dateOnlySchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`${field} must be a YYYY-MM-DD calendar date; received ${JSON.stringify(value)}.`)
  }
  return parseISO(parsed.data)
}

/**
 * When the evidence for this requirement stops being good. Computes; persists nothing.
 * Monitoring an expiry after hire is out of V1 (DOMAIN.md § Credentials).
 */
export function expiryFor(
  template: Pick<RequirementTemplate, 'validityRule' | 'validityMonths'>,
  evidence: { readonly issuedOn: string | null; readonly evidenceExpiresOn: string | null },
): Expiry {
  switch (template.validityRule) {
    case 'NEVER_EXPIRES':
      return { kind: 'NEVER' }

    case 'FROM_EVIDENCE': {
      if (evidence.evidenceExpiresOn === null) return { kind: 'UNKNOWN' }
      const expires = parseDateOnly(evidence.evidenceExpiresOn, 'evidenceExpiresOn')
      return { kind: 'ON', date: format(expires, 'yyyy-MM-dd') }
    }

    case 'FIXED_PERIOD': {
      if (evidence.issuedOn === null || template.validityMonths === null) return { kind: 'UNKNOWN' }
      const issued = parseDateOnly(evidence.issuedOn, 'issuedOn')
      // Months, not days: twelve months from a PPD lands on the same day of the month every
      // year, where days drift by one across a leap year. addMonths clamps 31 Jan + 1 month to
      // the end of February rather than overflowing into March.
      return { kind: 'ON', date: format(addMonths(issued, template.validityMonths), 'yyyy-MM-dd') }
    }
  }
}
