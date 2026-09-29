import {
  type TemplateEdit,
  type TemplateEditRequest,
  type TemplateRefusal,
  decideTemplatePublish,
  decideTemplateRetire,
} from '@/domain/requirements/template-admin'
import { runInAuditedTransaction, writeAuditEntry } from '../audit'
import { type PrismaTransactionClient, prisma } from '../prisma'
import {
  insertRequirementTemplateVersion,
  retireRequirementTemplate,
  toStoredTemplate,
} from './requirement-template-writer'
import type { StoredRequirementTemplate } from './requirement-templates'

export type TemplateWriteResult =
  | { readonly ok: true; readonly template: StoredRequirementTemplate }
  | { readonly ok: false; readonly refusal: TemplateRefusal | { readonly reason: 'NOT_FOUND' } }

export type TemplateRetireResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly refusal:
        | Extract<TemplateRefusal, { reason: 'AMBIGUOUS' }>
        | { readonly reason: 'NOT_FOUND' }
    }

const NOT_FOUND = { ok: false, refusal: { reason: 'NOT_FOUND' } } as const

// ADR-014: platform rows plus the agency's own, never another agency's.
async function visibleLive(
  client: Pick<PrismaTransactionClient, 'requirementTemplate'>,
  agencyId: string,
): Promise<readonly StoredRequirementTemplate[]> {
  const rows = await client.requirementTemplate.findMany({
    where: { retiredAt: null, OR: [{ agencyId: null }, { agencyId }] },
    include: { acceptedEvidence: { orderBy: { evidenceKey: 'asc' } } },
  })
  return rows.map(toStoredTemplate)
}

export function findVisibleLiveRequirementTemplates(
  agencyId: string,
): Promise<readonly StoredRequirementTemplate[]> {
  return visibleLive(prisma, agencyId)
}

function ownedBy(template: StoredRequirementTemplate, agencyId: string | null): boolean {
  return (template.scope.agencyId ?? null) === agencyId
}

function editOf(
  request: TemplateEditRequest,
  agencyId: string,
  visible: readonly StoredRequirementTemplate[],
): TemplateEdit<StoredRequirementTemplate> | null {
  switch (request.kind) {
    case 'ADD':
      return { kind: 'ADD', key: request.key, scope: request.scope }
    case 'OVERRIDE': {
      const base = visible.find((t) => t.id === request.baseId && ownedBy(t, null))
      return base === undefined ? null : { kind: 'OVERRIDE', base, narrowing: request.narrowing }
    }
    case 'EDIT': {
      const target = visible.find((t) => t.id === request.id && ownedBy(t, agencyId))
      return target === undefined ? null : { kind: 'EDIT', target }
    }
  }
}

// The UI writes only the agency's own rows: `agencyId` is never null here (ADR-148).
export function publishAgencyRequirementTemplate(
  agencyId: string,
  request: TemplateEditRequest,
  now: Date,
): Promise<TemplateWriteResult> {
  return runInAuditedTransaction(async (tx) => {
    const visible = await visibleLive(tx, agencyId)
    const edit = editOf(request, agencyId, visible)
    if (edit === null) return NOT_FOUND

    const decision = decideTemplatePublish(agencyId, edit, request.draft, visible)
    if (!decision.ok) return { ok: false, refusal: decision.refusal }

    const { state, serviceType, payer, role } = decision.scope
    const template = await insertRequirementTemplateVersion(
      tx,
      agencyId,
      { ...request.draft, key: decision.key, scope: { state, serviceType, payer, role } },
      now,
    )
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'REQUIREMENT_TEMPLATE',
      entityId: template.id,
    })
    return { ok: true, template }
  })
}

export function retireAgencyRequirementTemplate(
  agencyId: string,
  id: string,
  now: Date,
): Promise<TemplateRetireResult> {
  return runInAuditedTransaction(async (tx) => {
    const visible = await visibleLive(tx, agencyId)
    const target = visible.find((t) => t.id === id && ownedBy(t, agencyId))
    if (target === undefined) return NOT_FOUND

    const decision = decideTemplateRetire(agencyId, target, visible)
    if (!decision.ok) return decision

    await retireRequirementTemplate(tx, id, now)
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'REQUIREMENT_TEMPLATE',
      entityId: id,
      fieldName: 'retiredAt',
    })
    return { ok: true }
  })
}
