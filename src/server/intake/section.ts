import 'server-only'
import { runInAuditedTransaction } from '@/db/audit'
import * as repository from '@/db/repositories/caregiver-record'
import {
  findResolutionContext,
  materialiseRequirementInstances,
} from '@/db/repositories/requirement-instances'
import { type LoadedSection, type SectionSaveResult, recordScope } from '@/domain/forms/binding'
import type { FormSection } from '@/domain/forms/definition'
import type { SectionMissing } from '@/domain/forms/intake-flow'
import type { SectionSummary } from '@/domain/forms/summary'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// `section` is a server-side constant chosen by the caller, never a client payload. The agency is
// always the principal's; selfOnly makes `caregiverId` the principal's own.
export type IntakeSectionInput = { readonly caregiverId: string; readonly section: FormSection }
type IntakeSectionsInput = { readonly caregiverId: string; readonly sections: readonly FormSection[] }
export type SummariseUseCase = UseCase<IntakeSectionsInput, Readonly<Record<string, SectionSummary>>>

export const loadIntakeSection: UseCase<IntakeSectionInput, LoadedSection> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) =>
    repository.loadSectionAnswers(principal.agencyId, input.caregiverId, input.section),
)

export const saveIntakeSection: UseCase<
  IntakeSectionInput & { readonly answers: unknown },
  SectionSaveResult
> = defineUseCase('caregiver.editOwn', async ({ principal, input }) =>
  runInAuditedTransaction(async () => {
    const result = await repository.saveSectionAnswers(
      principal.agencyId,
      input.caregiverId,
      input.section,
      input.answers,
      new Date(),
    )
    // A profile save can change the role axis (ADR-138). An ambiguous result leaves the
    // instances as they were and the save committed (OPEN-QUESTIONS 226).
    if (result.saved && recordScope(input.section).records.includes('homeCareProfile')) {
      const context = await findResolutionContext(principal.agencyId, input.caregiverId)
      if (context !== null) {
        await materialiseRequirementInstances(principal.agencyId, input.caregiverId, context)
      }
    }
    return result
  }),
)

export const loadIntakeMissing: UseCase<IntakeSectionsInput, Readonly<Record<string, SectionMissing>>> = defineUseCase('caregiver.viewOwn', async ({ principal, input }) =>
  repository.loadSectionsMissing(principal.agencyId, input.caregiverId, input.sections, new Date()),
)

export const loadIntakeSummaries: SummariseUseCase = defineUseCase('caregiver.viewOwn', async ({ principal, input }) =>
  repository.loadSectionSummaries(principal.agencyId, input.caregiverId, input.sections),
)
