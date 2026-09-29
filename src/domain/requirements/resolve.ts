import { type TemplateScope, appliesTo, compareScopeSpecificity, scopeKeyOf } from './scope'
import type { RequirementTemplate } from './template'

export type ResolutionContext = Omit<TemplateScope, 'agencyId'>

export type ResolvableTemplate = Pick<RequirementTemplate, 'key' | 'scope' | 'retiredAt'>

export type TemplateAmbiguity<T extends ResolvableTemplate> = {
  readonly key: string
  readonly candidates: readonly T[]
}

export type ResolutionResult<T extends ResolvableTemplate> =
  | { readonly ok: true; readonly requirements: readonly T[] }
  | {
      readonly ok: false
      readonly ambiguities: readonly TemplateAmbiguity<T>[]
    }

function byText(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * The templates that apply to a caregiver, one per key: a template wins its key only when its
 * scope strictly contains every other applicable template's scope of that key. Keys with no such
 * winner are ambiguous, and any ambiguity fails the whole resolution — returning the rest would
 * silently drop a rule. There is no tiebreak by layer or input order (T-030 § Design 3).
 */
export function resolveRequirements<T extends ResolvableTemplate>(
  agencyId: string,
  context: ResolutionContext,
  templates: readonly T[],
): ResolutionResult<T> {
  const fullContext: TemplateScope = { ...context, agencyId }
  const byKey = new Map<string, T[]>()

  for (const template of templates) {
    if (template.retiredAt !== null || !appliesTo(template.scope, fullContext)) continue
    byKey.set(template.key, [...(byKey.get(template.key) ?? []), template])
  }

  const requirements: T[] = []
  const ambiguities: TemplateAmbiguity<T>[] = []

  for (const [key, group] of [...byKey].sort(([a], [b]) => byText(a, b))) {
    const maximal = group.filter(
      (template) =>
        !group.some((other) => compareScopeSpecificity(other.scope, template.scope) === 1),
    )
    const [winner] = maximal

    if (maximal.length === 1 && winner !== undefined) {
      requirements.push(winner)
    } else {
      ambiguities.push({
        key,
        candidates: maximal.sort((a, b) => byText(scopeKeyOf(a.scope), scopeKeyOf(b.scope))),
      })
    }
  }

  return ambiguities.length === 0 ? { ok: true, requirements } : { ok: false, ambiguities }
}
