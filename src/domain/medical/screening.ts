import { z } from 'zod'

// The source of truth for the medical store's vocabulary. The Prisma enums MedicalSection,
// MedicalResponse, MedicalScreeningItem and MedicalScreeningOutcome mirror these lists, because
// src/domain may not import src/db (ARCHITECTURE.md § Layers); keep the two in
// step.
export const MEDICAL_SECTIONS = [
  'MEDICAL_HISTORY',
  'PHYSICAL_CAPABILITY',
  'SCREENING_DETAIL',
] as const

// A numeric or free-scale answer is not representable: it goes in `detail` as text.
export const MEDICAL_RESPONSES = ['YES', 'NO', 'LIMITED', 'DECLINED_TO_ANSWER'] as const

export const MEDICAL_SCREENING_ITEMS = ['PHYSICAL_EXAM', 'TB_SCREENING', 'IMMUNISATION'] as const

// No PENDING: an item with no recorded outcome has no row, and absence is the third state.
export const MEDICAL_SCREENING_OUTCOMES = ['PASS', 'FAIL'] as const

export type MedicalSection = (typeof MEDICAL_SECTIONS)[number]
export type MedicalResponse = (typeof MEDICAL_RESPONSES)[number]
export type MedicalScreeningItem = (typeof MEDICAL_SCREENING_ITEMS)[number]
export type MedicalScreeningOutcome = (typeof MEDICAL_SCREENING_OUTCOMES)[number]

/**
 * The audit `fieldName` for a read or write of one section. It names a group of answer rows, not
 * a column, so that the log tells a clearance read from a full questionnaire read.
 */
export const MEDICAL_SECTION_FIELD_NAMES = {
  MEDICAL_HISTORY: 'medicalHistoryAnswers',
  PHYSICAL_CAPABILITY: 'physicalCapabilityAnswers',
  SCREENING_DETAIL: 'screeningDetailAnswers',
} as const satisfies Record<MedicalSection, string>

export const SCREENING_RESULTS_FIELD_NAME = 'screeningResults'

const QUESTION_KEY_MAX_LENGTH = 64

export const medicalAnswerInputSchema = z.strictObject({
  // A stable key from the form definition (T-045), never a question's prose.
  questionKey: z.string().min(1).max(QUESTION_KEY_MAX_LENGTH),
  response: z.enum(MEDICAL_RESPONSES),
  detail: z.string().optional(),
})

export const medicalScreeningResultInputSchema = z.strictObject({
  item: z.enum(MEDICAL_SCREENING_ITEMS),
  outcome: z.enum(MEDICAL_SCREENING_OUTCOMES),
  // A result date, not an instant (CONVENTIONS.md § Code).
  resultedOn: z.iso.date(),
})

export type MedicalAnswerInput = z.infer<typeof medicalAnswerInputSchema>
export type MedicalScreeningResultInput = z.infer<typeof medicalScreeningResultInputSchema>
