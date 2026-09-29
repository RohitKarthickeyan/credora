import { z } from 'zod'

// The source of truth for the voluntary self-identification vocabulary. The Prisma enums
// EeocGender and EeocRaceEthnicity mirror these lists, because src/domain may not import src/db
// (ARCHITECTURE.md § Layers); keep the two in step.

// NON_BINARY is not an EEO-1 Component 1 value; it is here so the form can record the answer
// the caregiver gave rather than fabricate one (T-011 § Risks 2, pending confirmation).
export const EEOC_GENDERS = ['MALE', 'FEMALE', 'NON_BINARY', 'DECLINE_TO_SELF_IDENTIFY'] as const

// The seven EEO-1 race/ethnicity categories verbatim, then the explicit refusal. One selection,
// as on the federal form: TWO_OR_MORE_RACES is a member, not a multi-select.
export const EEOC_RACE_ETHNICITIES = [
  'HISPANIC_OR_LATINO',
  'WHITE',
  'BLACK_OR_AFRICAN_AMERICAN',
  'NATIVE_HAWAIIAN_OR_OTHER_PACIFIC_ISLANDER',
  'ASIAN',
  'AMERICAN_INDIAN_OR_ALASKA_NATIVE',
  'TWO_OR_MORE_RACES',
  'DECLINE_TO_SELF_IDENTIFY',
] as const

// An absent answer means the question was left blank; DECLINE_TO_SELF_IDENTIFY is the explicit
// refusal. The two are counted separately.
export const eeocSelfIdentificationInputSchema = z.strictObject({
  gender: z.enum(EEOC_GENDERS).optional(),
  raceEthnicity: z.enum(EEOC_RACE_ETHNICITIES).optional(),
})

export type EeocSelfIdentificationInput = z.infer<typeof eeocSelfIdentificationInputSchema>

export type EeocGender = (typeof EEOC_GENDERS)[number]
export type EeocRaceEthnicity = (typeof EEOC_RACE_ETHNICITIES)[number]
