import { z } from 'zod'

// String literals, never `error: (iss) => …`: the function form receives the raw document
// number, which DATA-MODEL.md classes as Sensitive and never logged.
const SHAPE_ERROR = 'Enter the document number: 7 to 12 letters and digits.'

const stripSeparators = (value: string): string => value.replace(/[ -]/g, '')

// Shape only: an A-Number is 7-9 digits with an optional leading A, an I-94 number is 11
// characters. Which one the caregiver holds is not cross-checked here.
export const workAuthorizationNumberSchema = z
  .string()
  .trim()
  .transform((value) => stripSeparators(value).toUpperCase())
  .refine((value) => /^[A-Z0-9]{7,12}$/.test(value), { error: SHAPE_ERROR })
