import { z } from 'zod'

// 50 states + DC, plus the territories whose codes the W-4 and I-9 accept. The military codes
// AA/AE/AP address an overseas APO/FPO, which a home care aide working in New York does not have.
export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'MP', 'AS',
] as const

const usStateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(US_STATE_CODES, { error: 'Select a state or territory.' }))

export type UsState = z.infer<typeof usStateSchema>

const zipCodeSchema = z
  .string()
  .trim()
  .refine((zip) => /^\d{5}(?:-?\d{4})?$/.test(zip), { error: 'Enter a 5- or 9-digit ZIP code.' })
  .transform((zip) => (zip.length === 9 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip))

export const addressSchema = z.object({
  line1: z.string().trim().min(1, { error: 'Enter a street address.' }).max(100),
  line2: z
    .string()
    .trim()
    .max(100)
    // An HTML form posts an untouched optional field as '', not as absent.
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  city: z.string().trim().min(1, { error: 'Enter a city.' }).max(50),
  state: usStateSchema,
  zip: zipCodeSchema,
})

export type Address = z.infer<typeof addressSchema>
