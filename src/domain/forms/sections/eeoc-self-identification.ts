import {
  EEOC_GENDERS,
  EEOC_RACE_ETHNICITIES,
  type EeocSelfIdentificationInput,
  eeocSelfIdentificationInputSchema,
} from '@/domain/eeoc/self-identification'
import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { emptyAnswers } from '../answers'
import type { LoadedSection } from '../binding'
import type { FormSection } from '../definition'
import { type SectionIssues, validateSection } from '../validate'

const GENDER_LABELS: Record<(typeof EEOC_GENDERS)[number], string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  NON_BINARY: 'Non-binary',
  DECLINE_TO_SELF_IDENTIFY: 'I do not wish to self-identify',
}

const RACE_ETHNICITY_LABELS: Record<(typeof EEOC_RACE_ETHNICITIES)[number], string> = {
  HISPANIC_OR_LATINO: 'Hispanic or Latino',
  WHITE: 'White',
  BLACK_OR_AFRICAN_AMERICAN: 'Black or African American',
  NATIVE_HAWAIIAN_OR_OTHER_PACIFIC_ISLANDER: 'Native Hawaiian or Other Pacific Islander',
  ASIAN: 'Asian',
  AMERICAN_INDIAN_OR_ALASKA_NATIVE: 'American Indian or Alaska Native',
  TWO_OR_MORE_RACES: 'Two or more races',
  DECLINE_TO_SELF_IDENTIFY: 'I do not wish to self-identify',
}

const SUBMITTED_NOTE =
  'You have already submitted this form. Submitting again replaces your earlier answers; ' +
  'leaving both questions blank keeps them.'

export const EEOC_SELF_IDENTIFICATION_SECTION: FormSection = {
  id: 'eeoc-self-identification',
  title: 'Voluntary self-identification',
  description:
    'This form is voluntary. Your answers are kept separately from your personnel file, are never ' +
    'shown to agency staff, and are used only in anonymous totals. Choosing not to answer will not ' +
    'affect your application.',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.EEOC_SELF_IDENTIFICATION],
  items: [
    {
      kind: 'select',
      id: 'eeocGender',
      label: 'Gender',
      optional: true,
      options: EEOC_GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] })),
    },
    {
      kind: 'select',
      id: 'eeocRaceEthnicity',
      label: 'Race or ethnicity',
      optional: true,
      options: EEOC_RACE_ETHNICITIES.map((value) => ({ value, label: RACE_ETHNICITY_LABELS[value] })),
    },
  ],
}

// Never prefilled: no accessor returns a caregiver's EEOC answers, to anyone (SECURITY.md).
export function loadedEeocSection(submitted: boolean): LoadedSection {
  const section = submitted
    ? {
        ...EEOC_SELF_IDENTIFICATION_SECTION,
        description: `${EEOC_SELF_IDENTIFICATION_SECTION.description} ${SUBMITTED_NOTE}`,
      }
    : EEOC_SELF_IDENTIFICATION_SECTION
  return { section, answers: emptyAnswers(section) }
}

export type EeocSavePlan =
  | { readonly status: 'rejected'; readonly issues: SectionIssues }
  | {
      readonly status: 'accepted'
      readonly issues: SectionIssues
      readonly input: EeocSelfIdentificationInput | null
    }

export function planEeocSave(answers: unknown, asOf: Date): EeocSavePlan {
  const { invalid, missing, values } = validateSection(EEOC_SELF_IDENTIFICATION_SECTION, answers, asOf)
  if (Object.keys(invalid).length > 0) return { status: 'rejected', issues: { invalid, missing } }

  const { eeocGender: gender, eeocRaceEthnicity: raceEthnicity } = values
  // An all-blank submission writes nothing, so re-opening the (always blank) screen and moving on
  // cannot wipe an earlier submission (OPEN-QUESTIONS 138).
  const input =
    gender === undefined && raceEthnicity === undefined
      ? null
      : eeocSelfIdentificationInputSchema.parse({
          ...(gender !== undefined && { gender }),
          ...(raceEthnicity !== undefined && { raceEthnicity }),
        })
  return { status: 'accepted', issues: { invalid, missing }, input }
}
