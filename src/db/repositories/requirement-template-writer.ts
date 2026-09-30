import { type TemplateScope, layerOf, scopeKeyOf } from '@/domain/requirements/scope'
import { type RequirementTemplate, requirementTemplateSchema } from '@/domain/requirements/template'
import type { AcceptedEvidenceModel } from '../generated/models/AcceptedEvidence'
import type { RequirementTemplateModel } from '../generated/models/RequirementTemplate'
import type { PrismaTransactionClient } from '../prisma'
import type {
  PublishRequirementTemplateInput,
  StoredRequirementTemplate,
} from './requirement-templates'

// Value imports come only from @/domain/: `tsx prisma/seed.ts` (T-132) loads this module and
// cannot resolve `server-only`, which src/db/prisma.ts reaches through env (ADR-054). The
// client is a parameter for the same reason.

type RequirementTemplateWriter = Pick<PrismaTransactionClient, 'requirementTemplate'>

type TemplateRow = RequirementTemplateModel & {
  acceptedEvidence: AcceptedEvidenceModel[]
}

export function toStoredTemplate(row: TemplateRow): StoredRequirementTemplate {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    scope: {
      state: row.state,
      serviceType: row.serviceType,
      payer: row.payer,
      agencyId: row.agencyId,
      role: row.role,
    },
    layer: row.layer,
    name: row.name,
    description: row.description,
    type: row.type,
    acceptedEvidence: row.acceptedEvidence.map((option) => ({
      kind: option.kind,
      evidenceKey: option.evidenceKey,
      label: option.label,
    })),
    validityRule: row.validityRule,
    validityMonths: row.validityMonths,
    renewalRule: row.renewalRule,
    blocksClearance: row.blocksClearance,
    manualOnly: row.manualOnly,
    manualOnlyReason: row.manualOnlyReason,
    minimumMinutes: row.minimumMinutes,
    retiredAt: row.retiredAt,
  }
}

/**
 * The only writer of RequirementTemplate, and so the single place scopeKey, layer and version
 * are derived. Append-only: retires the live version for (scopeKey, key), if any, before
 * inserting the next one, because the live-version partial unique index would reject the new
 * row while the old one is still live.
 *
 * `agencyId = null` writes a platform rule, which ADR-014 permits only from the seeder; a use
 * case must always pass the session's agency.
 */
export async function insertRequirementTemplateVersion(
  tx: RequirementTemplateWriter,
  agencyId: string | null,
  input: PublishRequirementTemplateInput,
  now: Date,
): Promise<StoredRequirementTemplate> {
  const scope: TemplateScope = { ...input.scope, agencyId }
  const scopeKey = scopeKeyOf(scope)

  const latest = await tx.requirementTemplate.findFirst({
    where: { scopeKey, key: input.key },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const template = requirementTemplateSchema.parse({
    ...input,
    scope,
    layer: layerOf(scope),
    version: (latest?.version ?? 0) + 1,
    retiredAt: null,
  })

  await tx.requirementTemplate.updateMany({
    where: { scopeKey, key: template.key, retiredAt: null },
    data: { retiredAt: now },
  })

  const row = await tx.requirementTemplate.create({
    data: {
      agencyId,
      state: scope.state,
      serviceType: scope.serviceType,
      payer: scope.payer,
      role: scope.role,
      layer: template.layer,
      scopeKey,
      key: template.key,
      version: template.version,
      name: template.name,
      description: template.description,
      type: template.type,
      validityRule: template.validityRule,
      validityMonths: template.validityMonths,
      renewalRule: template.renewalRule,
      blocksClearance: template.blocksClearance,
      manualOnly: template.manualOnly,
      manualOnlyReason: template.manualOnlyReason,
      minimumMinutes: template.minimumMinutes,
      acceptedEvidence: {
        create: template.acceptedEvidence.map((option) => ({
          ...option,
          agencyId,
        })),
      },
    },
    include: { acceptedEvidence: { orderBy: { evidenceKey: 'asc' } } },
  })

  return toStoredTemplate(row)
}

type TemplateContent = Omit<RequirementTemplate, 'version' | 'scope' | 'layer' | 'retiredAt'>

function optionsOf(template: TemplateContent): string {
  return JSON.stringify(
    [...template.acceptedEvidence]
      .sort((a, b) => (a.evidenceKey < b.evidenceKey ? -1 : 1))
      .map((option) => [option.kind, option.evidenceKey, option.label]),
  )
}

function sameContent(a: TemplateContent, b: TemplateContent): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.type === b.type &&
    a.validityRule === b.validityRule &&
    a.validityMonths === b.validityMonths &&
    a.renewalRule === b.renewalRule &&
    a.blocksClearance === b.blocksClearance &&
    a.manualOnly === b.manualOnly &&
    a.manualOnlyReason === b.manualOnlyReason &&
    a.minimumMinutes === b.minimumMinutes &&
    optionsOf(a) === optionsOf(b)
  )
}

/**
 * Publishes `input` only when it differs from the live version for its scope and key, and
 * reports whether it did. This is what makes a seed idempotent, and how a corrected rule ships.
 */
export async function publishRequirementTemplateIfChanged(
  tx: RequirementTemplateWriter,
  agencyId: string | null,
  input: PublishRequirementTemplateInput,
  now: Date,
): Promise<boolean> {
  const scope: TemplateScope = { ...input.scope, agencyId }
  const live = await tx.requirementTemplate.findFirst({
    where: { scopeKey: scopeKeyOf(scope), key: input.key, retiredAt: null },
    include: { acceptedEvidence: true },
  })

  if (live !== null) {
    const candidate = requirementTemplateSchema.parse({
      ...input,
      scope,
      layer: layerOf(scope),
      version: live.version,
      retiredAt: null,
    })
    if (sameContent(toStoredTemplate(live), candidate)) return false
  }

  await insertRequirementTemplateVersion(tx, agencyId, input, now)
  return true
}

// Retired, never deleted: requirement instances point at the row.
export async function retireRequirementTemplate(
  tx: RequirementTemplateWriter,
  id: string,
  now: Date,
): Promise<void> {
  await tx.requirementTemplate.updateMany({
    where: { id, retiredAt: null },
    data: { retiredAt: now },
  })
}

/**
 * Retires the live platform rows of `state` that `library` no longer produces, so that deleting
 * a library entry withdraws the rule. Scoped to one state so another state's library cannot
 * retire it, and to platform rows because agency rows may have been edited since they were seeded.
 */
export async function retirePlatformTemplatesNotIn(
  tx: RequirementTemplateWriter,
  state: string,
  library: readonly PublishRequirementTemplateInput[],
  now: Date,
): Promise<number> {
  const produced = new Set(
    library.map((input) => `${scopeKeyOf({ ...input.scope, agencyId: null })}|${input.key}`),
  )
  const live = await tx.requirementTemplate.findMany({
    where: { agencyId: null, state, retiredAt: null },
    select: { id: true, scopeKey: true, key: true },
  })
  const withdrawn = live.filter((row) => !produced.has(`${row.scopeKey}|${row.key}`))
  const { count } = await tx.requirementTemplate.updateMany({
    where: { id: { in: withdrawn.map((row) => row.id) } },
    data: { retiredAt: now },
  })
  return count
}

/**
 * Retires the live rows of one agency whose key `library` still produces but under another scope,
 * so re-scoping a default withdraws the old row instead of leaving both resolvable. Rows whose key
 * the library does not produce are left alone: an administrator may have created them.
 */
export async function retireAgencyTemplatesRescopedBy(
  tx: RequirementTemplateWriter,
  agencyId: string,
  library: readonly PublishRequirementTemplateInput[],
  now: Date,
): Promise<void> {
  const produced = new Set(
    library.map((input) => `${scopeKeyOf({ ...input.scope, agencyId })}|${input.key}`),
  )
  const live = await tx.requirementTemplate.findMany({
    where: { agencyId, key: { in: library.map((input) => input.key) }, retiredAt: null },
    select: { id: true, scopeKey: true, key: true },
  })
  for (const row of live) {
    if (!produced.has(`${row.scopeKey}|${row.key}`)) await retireRequirementTemplate(tx, row.id, now)
  }
}
