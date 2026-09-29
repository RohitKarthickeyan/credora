import { z } from 'zod'

// String literals, never `error: (iss) => …`: the function form receives the raw bank data,
// which DATA-MODEL.md classes as Sensitive and never logged.
const SHAPE_ERROR = 'Enter the 9-digit routing number from the bottom-left of a cheque.'
const INVALID_ERROR = 'That routing number is not valid. Check the digits.'

const stripSeparators = (value: string): string => value.replace(/[ -]/g, '')

// Federal Reserve routing-symbol allocation. Beyond the checksum, which alone accepts 130000006;
// a bad routing number is a bounced deposit and a payroll incident.
function hasAssignedPrefix(digits: string): boolean {
  const prefix = Number(digits.slice(0, 2))

  return (
    prefix <= 12 ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80
  )
}

function hasValidChecksum(digits: string): boolean {
  let sum = 0
  let position = 0

  for (const char of digits) {
    const weight = position % 3 === 0 ? 3 : position % 3 === 1 ? 7 : 1
    sum += weight * Number(char)
    position += 1
  }

  return sum % 10 === 0
}

export const routingNumberSchema = z
  .string()
  .trim()
  .transform(stripSeparators)
  .refine((digits) => /^\d{9}$/.test(digits), { error: SHAPE_ERROR })
  .refine((digits) => hasAssignedPrefix(digits) && hasValidChecksum(digits), {
    error: INVALID_ERROR,
  })
