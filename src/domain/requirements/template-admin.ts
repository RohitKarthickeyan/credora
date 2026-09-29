import { z } from 'zod'
import { type ResolutionContext, resolveRequirements } from './resolve'
import {
  type TemplateScope,
  appliesTo,
  compareScopeSpecificity,
  layerOf,
  scopeKeyOf,
} from './scope'
import { type RequirementTemplate, requirementTemplateSchema } from './template'
import { CAREGIVER_ROLES, DOCUMENT_KEYS, PAYERS, SERVICE_TYPES, STATES } from './vocabulary'

const CONTEXT_AXES = ['state', 'serviceType', 'role', 'payer'] as const

export const scopeChoiceSchema = z.strictObject({
  state: z.enum(STATES).nullable(),
  serviceType: z.enum(SERVICE_TYPES).nullable(),
  role: z.enum(CAREGIVER_ROLES).nullable(),
  payer: z.enum(PAYERS).nullable(),
})
export type ScopeChoice = z.infer<typeof scopeChoiceSchema>

const DOCUMENT_KEY_VALUES: readonly string[] = Object.values(DOCUMENT_KEYS)
const fields = requirementTemplateSchema.shape

const templateDraftSchema = z
  .strictObject({
    name: fields.name,
    description: fields.description,
    type: fields.type,
    acceptedEvidence: fields.acceptedEvidence,
    validityRule: fields.validityRule,
    validityMonths: fields.validityMonths,
    renewalRule: fields.renewalRule,
    minimumMinutes: fields.minimumMinutes,
    blocksClearance: z.boolean(),
    manualOnly: z.boolean(),
    manualOnlyReason: z.string().trim().nullable(),
  })
  .superRefine((draft, ctx) => {
    draft.acceptedEvidence.forEach((option, index) => {
      if (option.kind === 'SIGNED_DOCUMENT' && !DOCUMENT_KEY_VALUES.includes(option.evidenceKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['acceptedEvidence', index, 'evidenceKey'],
          message:
            'A signed document must name a document Credora can generate; any other key fails ' +
            'only when the document is sent.',
        })
      }
    })
  })
type TemplateDraft = z.infer<typeof templateDraftSchema>

export const templateEditRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ADD'),
    key: fields.key,
    scope: scopeChoiceSchema,
    draft: templateDraftSchema,
  }),
  z.strictObject({
    kind: z.literal('OVERRIDE'),
    baseId: z.string().min(1),
    narrowing: scopeChoiceSchema,
    draft: templateDraftSchema,
  }),
  z.strictObject({ kind: z.literal('EDIT'), id: z.string().min(1), draft: templateDraftSchema }),
])
export type TemplateEditRequest = z.infer<typeof templateEditRequestSchema>

type AdminTemplate = Pick<
  RequirementTemplate,
  'key' | 'scope' | 'retiredAt' | 'manualOnly' | 'blocksClearance'
>

export type TemplateEdit<T extends AdminTemplate> =
  | { readonly kind: 'ADD'; readonly key: string; readonly scope: ScopeChoice }
  | { readonly kind: 'OVERRIDE'; readonly base: T; readonly narrowing: ScopeChoice }
  | { readonly kind: 'EDIT'; readonly target: T }

export type ContextAmbiguity = {
  readonly context: ResolutionContext
  readonly key: string
  readonly scopes: readonly TemplateScope[]
}

export type TemplateIssue = { readonly path: string; readonly message: string }

export type TemplateRefusal =
  | { readonly reason: 'INVALID'; readonly issues: readonly TemplateIssue[] }
  | {
      readonly reason: 'KEY_IN_USE' | 'OVERRIDE_EXISTS' | 'RELAXES_MANUAL_ONLY' | 'RELAXES_BLOCKING'
    }
  | { readonly reason: 'AMBIGUOUS'; readonly ambiguities: readonly ContextAmbiguity[] }

type PublishDecision =
  | { readonly ok: true; readonly key: string; readonly scope: TemplateScope }
  | { readonly ok: false; readonly refusal: TemplateRefusal }

function isPlatform(scope: TemplateScope): boolean {
  return scope.agencyId === null || scope.agencyId === undefined
}

// A base axis is never replaced: the override must stay a strict superset of the scope it
// overrides, or inclusion precedence would make it an ambiguity instead (T-031 § Risks 2).
function overrideScope(
  base: TemplateScope,
  agencyId: string,
  narrowing: ScopeChoice,
): TemplateScope {
  return {
    state: base.state ?? narrowing.state,
    serviceType: base.serviceType ?? narrowing.serviceType,
    payer: base.payer ?? narrowing.payer,
    role: base.role ?? narrowing.role,
    agencyId,
  }
}

// A context value no template names matches exactly what `null` matches, so null plus every
// named value is every context that can resolve differently.
function contextsFor(templates: readonly AdminTemplate[]): ResolutionContext[] {
  let contexts: ResolutionContext[] = [{}]
  for (const axis of CONTEXT_AXES) {
    const values = new Set<string>()
    for (const template of templates) {
      const value = template.scope[axis]
      if (value !== null && value !== undefined) values.add(value)
    }
    contexts = contexts.flatMap((context) => [
      context,
      ...[...values].map((value) => ({ ...context, [axis]: value })),
    ])
  }
  return contexts
}

function ambiguitiesIn(
  agencyId: string,
  context: ResolutionContext,
  templates: readonly AdminTemplate[],
): ContextAmbiguity[] {
  const result = resolveRequirements(agencyId, context, templates)
  if (result.ok) return []
  return result.ambiguities.map((ambiguity) => ({
    context,
    key: ambiguity.key,
    scopes: ambiguity.candidates.map((candidate) => candidate.scope),
  }))
}

function introducedAmbiguities<T extends AdminTemplate>(
  agencyId: string,
  before: readonly T[],
  after: readonly T[],
): readonly ContextAmbiguity[] {
  const introduced: ContextAmbiguity[] = []

  for (const context of contextsFor([...before, ...after])) {
    const existing = new Set(ambiguitiesIn(agencyId, context, before).map((a) => a.key))
    introduced.push(
      ...ambiguitiesIn(agencyId, context, after).filter((a) => !existing.has(a.key)),
    )
  }

  return introduced.sort((a, b) => {
    const byContext = scopeKeyOf(a.context).localeCompare(scopeKeyOf(b.context))
    return byContext !== 0 ? byContext : a.key.localeCompare(b.key)
  })
}

function liveOfKey<T extends AdminTemplate>(key: string, templates: readonly T[]): T[] {
  return templates.filter((template) => template.key === key && template.retiredAt === null)
}

function destinationOf<T extends AdminTemplate>(
  agencyId: string,
  edit: TemplateEdit<T>,
): { readonly key: string; readonly scope: TemplateScope } {
  switch (edit.kind) {
    case 'ADD':
      return { key: edit.key, scope: { ...edit.scope, agencyId } }
    case 'OVERRIDE':
      return { key: edit.base.key, scope: overrideScope(edit.base.scope, agencyId, edit.narrowing) }
    case 'EDIT':
      return { key: edit.target.key, scope: edit.target.scope }
  }
}

export function decideTemplatePublish<T extends AdminTemplate>(
  agencyId: string,
  edit: TemplateEdit<T>,
  draft: TemplateDraft,
  visibleLive: readonly T[],
): PublishDecision {
  const { key, scope } = destinationOf(agencyId, edit)
  const scopeKey = scopeKeyOf(scope)
  const before = liveOfKey(key, visibleLive)

  if (edit.kind === 'ADD' && before.length > 0) {
    return { ok: false, refusal: { reason: 'KEY_IN_USE' } }
  }
  if (edit.kind === 'OVERRIDE' && before.some((t) => scopeKeyOf(t.scope) === scopeKey)) {
    return { ok: false, refusal: { reason: 'OVERRIDE_EXISTS' } }
  }

  // version 1 is a placeholder: the writer assigns the real one, and no rule reads it.
  const parsed = requirementTemplateSchema.safeParse({
    ...draft,
    key,
    scope,
    layer: layerOf(scope),
    version: 1,
    retiredAt: null,
  })
  if (!parsed.success) {
    return {
      ok: false,
      refusal: {
        reason: 'INVALID',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    }
  }

  const overridden = before.filter(
    (template) =>
      isPlatform(template.scope) &&
      appliesTo(template.scope, scope) &&
      compareScopeSpecificity(scope, template.scope) === 1,
  )
  if (!draft.manualOnly && overridden.some((template) => template.manualOnly)) {
    return { ok: false, refusal: { reason: 'RELAXES_MANUAL_ONLY' } }
  }
  if (!draft.blocksClearance && overridden.some((template) => template.blocksClearance)) {
    return { ok: false, refusal: { reason: 'RELAXES_BLOCKING' } }
  }

  const published: AdminTemplate = {
    key,
    scope,
    retiredAt: null,
    manualOnly: draft.manualOnly,
    blocksClearance: draft.blocksClearance,
  }
  const after = [...before.filter((t) => scopeKeyOf(t.scope) !== scopeKey), published]
  const ambiguities = introducedAmbiguities<AdminTemplate>(agencyId, before, after)
  if (ambiguities.length > 0) return { ok: false, refusal: { reason: 'AMBIGUOUS', ambiguities } }

  return { ok: true, key, scope }
}

export function decideTemplateRetire<T extends AdminTemplate>(
  agencyId: string,
  target: T,
  visibleLive: readonly T[],
):
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: Extract<TemplateRefusal, { reason: 'AMBIGUOUS' }> } {
  const before = liveOfKey(target.key, visibleLive)
  const scopeKey = scopeKeyOf(target.scope)
  const after = before.filter((template) => scopeKeyOf(template.scope) !== scopeKey)
  const ambiguities = introducedAmbiguities(agencyId, before, after)
  return ambiguities.length === 0
    ? { ok: true }
    : { ok: false, refusal: { reason: 'AMBIGUOUS', ambiguities } }
}
