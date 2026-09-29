import type { z } from 'zod'
import type { ResolutionContext } from '@/domain/requirements/resolve'
import { candidateScopeKeys } from '@/domain/requirements/scope'
import type { RequirementTemplate, requirementTemplateSchema } from '@/domain/requirements/template'
import { prisma } from '../prisma'
import { toStoredTemplate } from './requirement-template-writer'

export type StoredRequirementTemplate = RequirementTemplate & {
  readonly id: string
}

export type PublishRequirementTemplateInput = Omit<
  z.input<typeof requirementTemplateSchema>,
  'version' | 'layer' | 'retiredAt' | 'scope'
> & { readonly scope: ResolutionContext }

/**
 * The live templates that could apply to a caregiver of `agencyId` in `context`. The agency
 * filter is ADR-014's tenancy guarantee and is not implied by the scopeKey filter: nothing in
 * the database ties scopeKey to agencyId, so a corrupted key must not become a cross-tenant read.
 */
export async function findLiveRequirementTemplates(
  agencyId: string,
  context: ResolutionContext,
): Promise<readonly StoredRequirementTemplate[]> {
  const rows = await prisma.requirementTemplate.findMany({
    where: {
      scopeKey: { in: [...candidateScopeKeys({ ...context, agencyId })] },
      retiredAt: null,
      OR: [{ agencyId: null }, { agencyId }],
    },
    include: { acceptedEvidence: { orderBy: { evidenceKey: 'asc' } } },
  })

  return rows.map(toStoredTemplate)
}
