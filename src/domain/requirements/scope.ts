import { z } from 'zod'

// The five axes a requirement template can be scoped by, in the order scopeKeyOf renders them.
// `role` was appended last, so it left every existing key byte-unchanged: scopeKeyOf omits
// absent axes rather than rendering them as empty.
export const SCOPE_AXES = ['state', 'serviceType', 'payer', 'agencyId', 'role'] as const
export type ScopeAxis = (typeof SCOPE_AXES)[number]

// The source of truth for the layer names. The Prisma enum `RequirementLayer` mirrors this
// list, because src/domain may not import src/db (ARCHITECTURE.md § Layers);
// keep the two in step.
export const REQUIREMENT_LAYERS = ['STATE', 'SERVICE_TYPE', 'ROLE', 'PAYER', 'AGENCY'] as const
export type RequirementLayer = (typeof REQUIREMENT_LAYERS)[number]

// `;` and `=` are the separators scopeKeyOf uses, so forbidding them in a value is what keeps
// the serialisation injective: no two distinct scopes can render to the same key.
const AXIS_VALUE_PATTERN = /^[A-Za-z0-9_.-]+$/

const AXIS_VALUE_ERROR =
  'A scope axis value may contain only letters, digits, underscore, dot and hyphen. ";" and ' +
  '"=" separate a scopeKey, so a value containing one would make two different scopes share a key.'

// `.nullish()` rather than `.optional()`: a template row reads its five axes out of nullable
// Postgres columns, and an axis that is absent and one that is SQL NULL are the same fact.
const axisValueSchema = z.string().regex(AXIS_VALUE_PATTERN, { error: AXIS_VALUE_ERROR }).nullish()

export const templateScopeSchema = z
  .object({
    state: axisValueSchema,
    serviceType: axisValueSchema,
    payer: axisValueSchema,
    agencyId: axisValueSchema,
    role: axisValueSchema,
  })
  .refine((scope) => SCOPE_AXES.some((axis) => scope[axis] !== null && scope[axis] !== undefined), {
    error:
      'A requirement template must be scoped by at least one axis. An all-null scope renders ' +
      'the empty scopeKey and would apply to every caregiver in every agency.',
  })

export type TemplateScope = z.infer<typeof templateScopeSchema>

function presentAxes(scope: TemplateScope): ScopeAxis[] {
  return SCOPE_AXES.filter((axis) => scope[axis] !== null && scope[axis] !== undefined)
}

/**
 * The canonical serialisation of a scope: `name=value` for each present axis, in SCOPE_AXES
 * order, joined by `;`. Absent axes are omitted, so adding an axis later changes no existing
 * key. An all-null scope renders `''`, which templateScopeSchema rejects.
 */
export function scopeKeyOf(scope: TemplateScope): string {
  return presentAxes(scope)
    .map((axis) => `${axis}=${String(scope[axis])}`)
    .join(';')
}

/** The narrowest present axis, as a label. Not the override rule — see compareScopeSpecificity. */
export function layerOf(scope: TemplateScope): RequirementLayer {
  if (scope.agencyId !== null && scope.agencyId !== undefined) return 'AGENCY'
  if (scope.payer !== null && scope.payer !== undefined) return 'PAYER'
  if (scope.role !== null && scope.role !== undefined) return 'ROLE'
  if (scope.serviceType !== null && scope.serviceType !== undefined) return 'SERVICE_TYPE'
  return 'STATE'
}

/**
 * Whether a template scoped by `scope` applies in `context`: every present axis of the
 * template equals the context's value for that axis. An axis the template leaves absent
 * matches any context value; an axis the template sets and the context does not match nothing.
 */
export function appliesTo(scope: TemplateScope, context: TemplateScope): boolean {
  return presentAxes(scope).every((axis) => scope[axis] === context[axis])
}

/**
 * Precedence between two applicable scopes, by inclusion of their present-axis sets: `1` when
 * `a` is strictly narrower, `-1` when `b` is, `0` when the sets are equal.
 *
 * Returns `null` when the sets are incomparable — `{state}` versus `{serviceType}` — because
 * inclusion is a partial order and there is no defensible winner. There is deliberately no
 * number to sort by: T-031 must raise an ambiguity error rather than pick by declaration order.
 */
export function compareScopeSpecificity(
  a: TemplateScope,
  b: TemplateScope,
): -1 | 0 | 1 | null {
  const axesOfA = presentAxes(a)
  const axesOfB = presentAxes(b)
  const aContainsB = axesOfB.every((axis) => axesOfA.includes(axis))
  const bContainsA = axesOfA.every((axis) => axesOfB.includes(axis))

  if (aContainsB && bContainsA) return 0
  if (aContainsB) return 1
  if (bContainsA) return -1
  return null
}

/**
 * Every scopeKey a template applicable in `context` could carry: the non-empty subsets of the
 * context's present axes, rendered. The inverse of scopeKeyOf, and here rather than in T-031
 * so that the format is written down once. T-031's query is one indexed `scopeKey IN (...)`.
 */
export function candidateScopeKeys(context: TemplateScope): readonly string[] {
  const axes = presentAxes(context)
  const keys: string[] = []

  for (let mask = 1; mask < 2 ** axes.length; mask += 1) {
    keys.push(
      axes
        .filter((_, index) => (mask & (1 << index)) !== 0)
        .map((axis) => `${axis}=${String(context[axis])}`)
        .join(';'),
    )
  }

  return keys
}

/**
 * Display ordering for T-034's template list, broad to narrow. This is **not** the override
 * rule — compareScopeSpecificity is. A PAYER template does not beat a SERVICE_TYPE one by
 * virtue of its layer; it beats it only if its axis set is a strict superset.
 */
export const LAYER_PRECEDENCE: Readonly<Record<RequirementLayer, number>> = {
  STATE: 0,
  SERVICE_TYPE: 1,
  ROLE: 2,
  PAYER: 3,
  AGENCY: 4,
}
