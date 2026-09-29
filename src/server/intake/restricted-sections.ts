import 'server-only'
import { hasEeocResponse, saveEeocSelfIdentification } from '@/db/restricted/eeoc'
import { readMedicalAnswers, saveMedicalAnswers } from '@/db/restricted/medical'
import type { LoadedSection, SectionSaveResult } from '@/domain/forms/binding'
import { loadedEeocSection, planEeocSave } from '@/domain/forms/sections/eeoc-self-identification'
import {
  loadedMedicalSection,
  medicalSectionOf,
  planMedicalSave,
} from '@/domain/forms/sections/medical-questionnaire'
import { type SectionSummary, summariseSection } from '@/domain/forms/summary'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import type { IntakeSectionInput, SummariseUseCase } from './section'

type SaveInput = IntakeSectionInput & { readonly answers: unknown }

export const loadMedicalIntakeSection: UseCase<IntakeSectionInput, LoadedSection> = defineUseCase(
  'medicalFile.viewOwn',
  async ({ principal, input }) =>
    loadedMedicalSection(
      input.section,
      await readMedicalAnswers(principal.agencyId, input.caregiverId, medicalSectionOf(input.section)),
    ),
)

// One accessor read, and its own audit entry, per section; never combined with a core query.
export const summariseMedicalIntakeSections: SummariseUseCase = defineUseCase(
  'medicalFile.viewOwn',
  async ({ principal, input }) => {
    const summaries: Record<string, SectionSummary> = {}
    for (const section of input.sections) {
      const answers = await readMedicalAnswers(principal.agencyId, input.caregiverId, medicalSectionOf(section))
      summaries[section.id] = summariseSection(loadedMedicalSection(section, answers), {})
    }
    return summaries
  },
)

export const saveMedicalIntakeSection: UseCase<SaveInput, SectionSaveResult> = defineUseCase(
  'medicalFile.editOwn',
  async ({ principal, input }) => {
    const plan = planMedicalSave(input.section, input.answers, new Date())
    if (plan.status === 'rejected') return { ...plan.issues, saved: false }
    await saveMedicalAnswers(
      principal.agencyId,
      input.caregiverId,
      medicalSectionOf(input.section),
      plan.answers,
    )
    return { ...plan.issues, saved: true }
  },
)

export const loadEeocIntakeSection: UseCase<IntakeSectionInput, LoadedSection> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) =>
    loadedEeocSection(await hasEeocResponse(principal.agencyId, input.caregiverId)),
)

// Only whether a response exists: the EEOC form is write-only, the caregiver included (ADR-084).
export const summariseEeocIntakeSections: SummariseUseCase = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) => {
    const value = (await hasEeocResponse(principal.agencyId, input.caregiverId)) ? 'Submitted' : 'Not answered'
    return Object.fromEntries(
      input.sections.map((section): [string, SectionSummary] => [
        section.id,
        { id: section.id, title: section.title, items: [{ kind: 'field', label: 'Your answers', value }] },
      ]),
    )
  },
)

// The result carries only constant issue messages, never an answer, so the save cannot become a
// read channel for EEOC data.
export const saveEeocIntakeSection: UseCase<SaveInput, SectionSaveResult> = defineUseCase(
  'eeocSelfIdentification.submitOwn',
  async ({ principal, input }) => {
    const plan = planEeocSave(input.answers, new Date())
    if (plan.status === 'rejected') return { ...plan.issues, saved: false }
    if (plan.input !== null) {
      await saveEeocSelfIdentification(principal.agencyId, input.caregiverId, plan.input)
    }
    return { ...plan.issues, saved: true }
  },
)
