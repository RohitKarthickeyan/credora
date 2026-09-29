import {
  type MedicalAnswerInput,
  type MedicalResponse,
  type MedicalSection,
  medicalAnswerInputSchema,
} from '@/domain/medical/screening'
import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { type RawAnswers, emptyAnswers } from '../answers'
import type { LoadedSection } from '../binding'
import type { FormField, FormSection } from '../definition'
import { type SectionIssues, validateSection } from '../validate'

const REQUIRED_BY = [INTAKE_REQUIREMENT_KEYS.MEDICAL_QUESTIONNAIRE] as const
const DETAIL_MAX_LENGTH = 500
const DESCRIPTION =
  'Your answers are kept in a separate confidential medical file, not in your personnel file. ' +
  'Agency staff see only whether your health screening is complete.'

type Option = { readonly value: MedicalResponse; readonly label: string }
type Detail = { readonly equals: MedicalResponse | readonly [MedicalResponse, ...MedicalResponse[]]; readonly label: string }

const HISTORY_OPTIONS: readonly Option[] = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'DECLINED_TO_ANSWER', label: 'I prefer not to answer' },
]
const HISTORY_DETAIL: Detail = { equals: 'YES', label: 'If yes, tell us more (optional)' }

const CAPABILITY_OPTIONS: readonly Option[] = [
  { value: 'YES', label: 'Yes' },
  { value: 'LIMITED', label: 'Yes, with some limits' },
  { value: 'NO', label: 'No' },
  { value: 'DECLINED_TO_ANSWER', label: 'I prefer not to answer' },
]
const CAPABILITY_DETAIL: Detail = { equals: ['LIMITED', 'NO'], label: 'Tell us about any limits (optional)' }

const detailId = (questionKey: string) => `${questionKey}Detail`

// The field id is the stored questionKey: it must never change once answers exist, even when the
// wording does.
function question(
  questionKey: string,
  label: string,
  options: readonly Option[],
  detail: Detail,
): readonly FormField[] {
  return [
    { kind: 'select', id: questionKey, label, options },
    {
      kind: 'text',
      id: detailId(questionKey),
      label: detail.label,
      maxLength: DETAIL_MAX_LENGTH,
      optional: true,
      visibleWhen: { field: questionKey, equals: detail.equals },
    },
  ]
}

// GINA forbids an employer requesting family medical history, so no question may ask about it.
export const MEDICAL_HISTORY_SECTION: FormSection = {
  id: 'medical-history',
  title: 'Medical history',
  description: DESCRIPTION,
  requiredBy: REQUIRED_BY,
  items: ([
    ['historyTuberculosis', 'Have you ever had a positive TB skin or blood test, or been treated for tuberculosis?'],
    ['historyContagiousIllness', 'Do you currently have a contagious illness, such as a skin or respiratory infection?'],
    ['historyMusculoskeletalInjury', 'Do you have a back, neck or joint injury that still limits how you move or lift?'],
    ['historyLatexAllergy', 'Are you allergic to latex?'],
    [
      'historyDrowsyMedication',
      'Do you take any medicine that makes you drowsy or could affect your ability to work safely?',
    ],
    [
      'historyConditionAffectingDuties',
      'Do you have any other health condition that could affect your ability to do the duties of a home care aide?',
    ],
  ] as const).flatMap(([key, label]) => question(key, label, HISTORY_OPTIONS, HISTORY_DETAIL)),
}

export const PHYSICAL_CAPABILITY_SECTION: FormSection = {
  id: 'physical-capability',
  title: 'Physical capability',
  description: DESCRIPTION,
  requiredBy: REQUIRED_BY,
  items: ([
    ['capabilityLift50lb', 'Can you lift and carry up to 50 pounds?'],
    ['capabilityStandWalkShift', 'Can you stand and walk for most of a shift?'],
    ['capabilityBendKneelReach', 'Can you bend, kneel and reach to help a client?'],
    ['capabilityTransferClient', 'Can you help move a client from a bed to a chair, using a transfer aid if needed?'],
  ] as const).flatMap(([key, label]) => question(key, label, CAPABILITY_OPTIONS, CAPABILITY_DETAIL)),
}

export type MedicalIntakeSection = Exclude<MedicalSection, 'SCREENING_DETAIL'>

/** Throws if `section` is not one of the two (programmer error — the caller dispatched wrongly). */
export function medicalSectionOf(section: FormSection): MedicalIntakeSection {
  if (section.id === MEDICAL_HISTORY_SECTION.id) return 'MEDICAL_HISTORY'
  if (section.id === PHYSICAL_CAPABILITY_SECTION.id) return 'PHYSICAL_CAPABILITY'
  throw new Error(`Section ${section.id} is not a medical questionnaire section.`)
}

export type StoredMedicalAnswer = {
  readonly questionKey: string
  readonly response: MedicalResponse
  readonly detail: string | null
}

const questionsOf = (section: FormSection) =>
  section.items.flatMap((item) => (item.kind === 'select' ? [item] : []))

export function loadedMedicalSection(
  section: FormSection,
  stored: readonly StoredMedicalAnswer[],
): LoadedSection {
  const answers: Record<string, RawAnswers[string]> = { ...emptyAnswers(section) }
  const questions = questionsOf(section)
  for (const row of stored) {
    const item = questions.find((candidate) => candidate.id === row.questionKey)
    if (!item?.options.some((option) => option.value === row.response)) continue
    answers[row.questionKey] = row.response
    answers[detailId(row.questionKey)] = row.detail ?? ''
  }
  return { section, answers }
}

export type MedicalSavePlan =
  | { readonly status: 'rejected'; readonly issues: SectionIssues }
  | {
      readonly status: 'accepted'
      readonly issues: SectionIssues
      readonly answers: readonly MedicalAnswerInput[]
    }

export function planMedicalSave(section: FormSection, answers: unknown, asOf: Date): MedicalSavePlan {
  const { invalid, missing, values } = validateSection(section, answers, asOf)
  if (Object.keys(invalid).length > 0) return { status: 'rejected', issues: { invalid, missing } }

  const rows = questionsOf(section)
    .filter((item) => values[item.id] !== undefined)
    .map((item) => {
      const detail = values[detailId(item.id)]
      return medicalAnswerInputSchema.parse({
        questionKey: item.id,
        response: values[item.id],
        ...(detail !== undefined && { detail }),
      })
    })
  return { status: 'accepted', issues: { invalid: {}, missing }, answers: rows }
}
