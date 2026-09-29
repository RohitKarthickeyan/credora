import { z } from 'zod'

// Messages are string literals, never `error: (iss) => …`: the function form receives
// `iss.input`, which here is the SSN itself, and SECURITY.md § Audit log forbids a value
// reaching a log or a rendered message.
const SHAPE_ERROR = 'Enter a 9-digit Social Security number.'
const ISSUANCE_ERROR = 'That is not a Social Security number the SSA issues. Check the digits.'

// Only spaces and hyphens: a paste carrying anything else is rejected rather than silently
// corrected into a payroll-critical field.
const stripSeparators = (value: string): string => value.replace(/[ -]/g, '')

const isNineDigits = (value: string): boolean => /^\d{9}$/.test(value)

function isIssuable(value: string): boolean {
  const area = Number(value.slice(0, 3))
  const group = Number(value.slice(3, 5))
  const serial = Number(value.slice(5, 9))

  return area !== 0 && area !== 666 && area < 900 && group !== 0 && serial !== 0
}

export const ssnSchema = z
  .string()
  .trim()
  .transform(stripSeparators)
  .refine(isNineDigits, { error: SHAPE_ERROR })
  .refine(isIssuable, { error: ISSUANCE_ERROR })

export function formatSsn(ssn: string): string {
  return `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5, 9)}`
}

export function ssnLast4(ssn: string): string {
  return ssn.slice(-4)
}
