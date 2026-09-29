import 'server-only'
import { z } from 'zod'
import * as repository from '@/db/repositories/requirement-template-admin'
import type {
  TemplateRetireResult,
  TemplateWriteResult,
} from '@/db/repositories/requirement-template-admin'
import {
  type StoredRequirementTemplate,
  findLiveRequirementTemplates,
} from '@/db/repositories/requirement-templates'
import { type ResolutionResult, resolveRequirements } from '@/domain/requirements/resolve'
import {
  type ScopeChoice,
  type TemplateEditRequest,
  scopeChoiceSchema,
  templateEditRequestSchema,
} from '@/domain/requirements/template-admin'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's (ADR-148): a use case never passes
// null, so no path from here writes a platform row. Inputs are parsed again because they arrive
// from a form and the type parameter is not a runtime check.
const idSchema = z.strictObject({ id: z.string().min(1) })
const previewInputSchema = z.strictObject({ context: scopeChoiceSchema })

export const listRequirementTemplates: UseCase<
  Record<string, never>,
  readonly StoredRequirementTemplate[]
> = defineUseCase('requirementTemplate.manage', async ({ principal }) =>
  repository.findVisibleLiveRequirementTemplates(principal.agencyId),
)

export const previewRequirementResolution: UseCase<
  { readonly context: ScopeChoice },
  ResolutionResult<StoredRequirementTemplate>
> = defineUseCase('requirementTemplate.manage', async ({ principal, input }) => {
  const { context } = previewInputSchema.parse(input)
  const templates = await findLiveRequirementTemplates(principal.agencyId, context)
  return resolveRequirements(principal.agencyId, context, templates)
})

export const publishRequirementTemplateEdit: UseCase<TemplateEditRequest, TemplateWriteResult> =
  defineUseCase('requirementTemplate.manage', async ({ principal, input }) =>
    repository.publishAgencyRequirementTemplate(
      principal.agencyId,
      templateEditRequestSchema.parse(input),
      new Date(),
    ),
  )

export const retireRequirementTemplate: UseCase<{ readonly id: string }, TemplateRetireResult> =
  defineUseCase('requirementTemplate.manage', async ({ principal, input }) =>
    repository.retireAgencyRequirementTemplate(
      principal.agencyId,
      idSchema.parse(input).id,
      new Date(),
    ),
  )
