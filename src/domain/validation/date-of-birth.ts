import { differenceInYears, isBefore, parseISO, startOfDay } from 'date-fns'
import { z } from 'zod'

// UNCONFIRMED (T-004 § Risks 1): no NY statutory minimum age for a PCA or HHA was established.
// 18 is a product default — intake ends in an e-signed W-4, I-9 §1 and direct-deposit
// authorisation, and a minor's signature on those is at best voidable. Confirm with the product
// owner before this reaches a real caregiver.
const MINIMUM_AGE_YEARS = 18

// Typo guard, not a rule: 1890-01-01 is a slipped keystroke, not a caregiver.
export const MAXIMUM_AGE_YEARS = 100

const SHAPE_ERROR = 'Enter a date of birth as YYYY-MM-DD.'
const FUTURE_ERROR = 'Date of birth must be in the past.'
const TOO_YOUNG_ERROR = `A caregiver must be at least ${MINIMUM_AGE_YEARS} years old.`
const TOO_OLD_ERROR = 'Check the year of birth.'

export function dateOfBirthSchema(asOf: Date): z.ZodType<string, string> {
  // Both sides are anchored at local midnight: parseISO of a date-only string already returns
  // it, and startOfDay strips the request clock's time. Comparing a date against a timestamp
  // is what shifts an age across a year boundary.
  const today = startOfDay(asOf)

  // z.iso.date() encodes month lengths and the full Gregorian leap rule, so 2026-02-30 and
  // 1900-02-29 are already rejected here; no date-fns calendar check is needed.
  return z.iso
    .date({ error: SHAPE_ERROR })
    .refine((dob) => isBefore(parseISO(dob), today), { error: FUTURE_ERROR })
    .refine((dob) => differenceInYears(today, parseISO(dob)) >= MINIMUM_AGE_YEARS, {
      error: TOO_YOUNG_ERROR,
    })
    .refine((dob) => differenceInYears(today, parseISO(dob)) <= MAXIMUM_AGE_YEARS, {
      error: TOO_OLD_ERROR,
    })
}
