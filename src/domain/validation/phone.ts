import { z } from 'zod'

const PHONE_ERROR = 'Enter a 10-digit US mobile number, like (212) 555-0147.'

// NPA NXX XXXX. Each of NPA and NXX starts 2-9 and is not an N11 service code (211 … 911).
const NANP_PATTERN = /^[2-9](?:[02-9]\d|\d[02-9])[2-9](?:[02-9]\d|\d[02-9])\d{4}$/

function toNationalDigits(value: string): string {
  const compact = value.trim().replace(/[^\d+]/g, '')
  const withoutPlus = compact.startsWith('+') ? compact.slice(1) : compact

  return withoutPlus.length === 11 && withoutPlus.startsWith('1')
    ? withoutPlus.slice(1)
    : withoutPlus
}

// Canonical form is E.164, the form AlayaCare's phone fields take; the +1 is captured once rather
// than re-derived on every use.
export const phoneSchema = z
  .string()
  .transform(toNationalDigits)
  .refine((digits) => NANP_PATTERN.test(digits), { error: PHONE_ERROR })
  .transform((digits) => `+1${digits}`)

export function formatPhone(phone: string): string {
  const digits = phone.slice(2)

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}
