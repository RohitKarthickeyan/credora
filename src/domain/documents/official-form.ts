import { z } from 'zod'
import {
  BANK_ACCOUNT_TYPES,
  EYE_COLORS,
  HAIR_COLORS,
  IT2104_FILING_STATUSES,
  type RecordFieldName,
  SEX_MARKERS,
  W4_FILING_STATUSES,
  WORK_AUTHORIZATION_TYPES,
} from '@/domain/forms/canonical-record'
import type { SensitiveField } from '@/domain/masking/sensitive-field'
import { addressSchema } from '@/domain/validation/address'

// A tax form can print only a complete mailing address, so a partial one reads as null here.
export const officialFormRecordSchema = z.strictObject({
  agencyName: z.string(),
  legalFirstName: z.string().nullable(),
  legalMiddleName: z.string().nullable(),
  legalLastName: z.string().nullable(),
  nameSuffix: z.string().nullable(),
  otherNames: z.array(z.string()),
  dateOfBirth: z.iso.date().nullable(),
  sex: z.enum(SEX_MARKERS).nullable(),
  countryOfBirth: z.string().nullable(),
  heightInches: z.int().nullable(),
  weightPounds: z.int().nullable(),
  eyeColor: z.enum(EYE_COLORS).nullable(),
  hairColor: z.enum(HAIR_COLORS).nullable(),
  workAuthorizationType: z.enum(WORK_AUTHORIZATION_TYPES).nullable(),
  workAuthorizationExpiresAt: z.iso.date().nullable(),
  address: addressSchema.nullable(),
  hourlyRateCents: z.int().nullable(),
  overtimeRateCents: z.int().nullable(),
  w4FilingStatus: z.enum(W4_FILING_STATUSES).nullable(),
  w4MultipleJobs: z.boolean().nullable(),
  w4DependentsAmountCents: z.int().nullable(),
  w4OtherIncomeCents: z.int().nullable(),
  w4DeductionsCents: z.int().nullable(),
  w4ExtraWithholdingCents: z.int().nullable(),
  it2104FilingStatus: z.enum(IT2104_FILING_STATUSES).nullable(),
  it2104ResidentNyc: z.boolean().nullable(),
  it2104ResidentYonkers: z.boolean().nullable(),
  it2104AllowancesNy: z.int().nullable(),
  it2104AllowancesNyc: z.int().nullable(),
  it2104ExtraWithholdingNyCents: z.int().nullable(),
  bankName: z.string().nullable(),
  bankAccountType: z.enum(BANK_ACCOUNT_TYPES).nullable(),
})

export type OfficialFormRecord = z.infer<typeof officialFormRecordSchema>

export type SealedFormValues = Readonly<Partial<Record<SensitiveField, string>>>

export type OfficialFormField = RecordFieldName | 'hourlyRateCents'

export type OfficialFormRefusal =
  | { readonly documentKey: string; readonly reason: 'no-template' }
  | {
      readonly documentKey: string
      readonly reason: 'missing-fields'
      readonly fields: readonly OfficialFormField[]
    }
  | {
      readonly documentKey: string
      readonly reason: 'unprintable'
      readonly fields: readonly OfficialFormField[]
    }
  | {
      readonly documentKey: string
      readonly reason: 'does-not-fit'
      readonly fields: readonly OfficialFormField[]
    }

// The standard PDF fonts encode WinAnsi only: Latin-1 plus the 27 cp1252 extras.
const WIN_ANSI = /^[\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/u

export function isWinAnsi(text: string): boolean {
  return WIN_ANSI.test(text)
}
