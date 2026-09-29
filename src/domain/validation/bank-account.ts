import { z } from 'zod'

// String literals, never `error: (iss) => …`: the function form receives the raw bank data,
// which DATA-MODEL.md classes as Sensitive and never logged.
const SHAPE_ERROR = 'Enter the account number: 4 to 17 digits.'

const stripSeparators = (value: string): string => value.replace(/[ -]/g, '')

export const bankAccountNumberSchema = z
  .string()
  .trim()
  .transform(stripSeparators)
  .refine((digits) => /^\d{4,17}$/.test(digits), { error: SHAPE_ERROR })
