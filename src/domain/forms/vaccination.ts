import { type FormSection, formSectionSchema } from './definition'

export const HEPATITIS_B_CHOICES = ['CONSENT', 'DECLINE'] as const
export type HepatitisBChoice = (typeof HEPATITIS_B_CHOICES)[number]
export const FLU_VACCINATION_CHOICES = ['VACCINATED', 'DECLINED'] as const
type FluVaccinationChoice = (typeof FLU_VACCINATION_CHOICES)[number]

// Both the option labels and the printed text: the caregiver signs exactly the words they picked.
export const HEPATITIS_B_CHOICE_LABELS: Readonly<Record<HepatitisBChoice, string>> = {
  CONSENT: 'I consent to receive the hepatitis B vaccine.',
  DECLINE: 'I decline the hepatitis B vaccine.',
}
export const FLU_VACCINATION_CHOICE_LABELS: Readonly<Record<FluVaccinationChoice, string>> = {
  VACCINATED: "I have received this season's flu vaccine.",
  DECLINED: "I decline this season's flu vaccine.",
}

export type FluVaccinationStatement =
  | { readonly choice: 'VACCINATED' }
  | { readonly choice: 'DECLINED'; readonly reason: string }

export const HEPATITIS_B_SECTION: FormSection = formSectionSchema.parse({
  id: 'hepatitisBVaccination',
  title: 'Hepatitis B vaccine',
  requiredBy: ['HEPATITIS_B_VACCINATION'],
  items: [
    {
      kind: 'select',
      id: 'hepatitisBChoice',
      label: 'Your decision',
      options: HEPATITIS_B_CHOICES.map((value) => ({
        value,
        label: HEPATITIS_B_CHOICE_LABELS[value],
      })),
    },
  ],
})

export const FLU_VACCINATION_SECTION: FormSection = formSectionSchema.parse({
  id: 'fluVaccination',
  title: 'Flu vaccine',
  requiredBy: ['FLU_VACCINATION'],
  items: [
    {
      kind: 'select',
      id: 'fluVaccinationChoice',
      label: 'This flu season',
      options: FLU_VACCINATION_CHOICES.map((value) => ({
        value,
        label: FLU_VACCINATION_CHOICE_LABELS[value],
      })),
    },
    {
      kind: 'text',
      id: 'fluDeclinationReason',
      label: 'Why are you declining?',
      maxLength: 500,
      visibleWhen: { field: 'fluVaccinationChoice', equals: 'DECLINED' },
    },
  ],
})

export function toHepatitisBChoice(stored: string | null): HepatitisBChoice | null {
  return HEPATITIS_B_CHOICES.find((choice) => choice === stored) ?? null
}

// An incomplete statement is a missing answer, never half a document.
export function toFluVaccinationStatement(
  choice: string | null,
  reason: string | null,
): FluVaccinationStatement | null {
  if (choice === 'VACCINATED') return { choice }
  if (choice === 'DECLINED' && reason !== null && reason.trim() !== '') return { choice, reason }
  return null
}
