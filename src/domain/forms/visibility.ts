import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { FormField, FormGroup, FormSection } from './definition'

// A waived requirement needs nothing from the caregiver. SATISFIED keeps its section so a
// caregiver can come back and edit.
export function activeRequirementKeys(
  instances: readonly { readonly templateKey: string; readonly status: InstanceStatus }[],
): ReadonlySet<string> {
  return new Set(
    instances.filter((instance) => instance.status !== 'WAIVED').map((instance) => instance.templateKey),
  )
}

export function visibleSections(
  sections: readonly FormSection[],
  activeKeys: ReadonlySet<string>,
): readonly FormSection[] {
  return sections.filter((section) => section.requiredBy.some((key) => activeKeys.has(key)))
}

// A hidden controller hides its dependants even when a stale answer is still present.
export function visibleItems<T extends FormField | FormGroup>(
  items: readonly T[],
  answers: Readonly<Record<string, unknown>>,
): readonly T[] {
  const visible = new Set<string>()

  return items.filter((item) => {
    const condition = item.kind === 'group' ? undefined : item.visibleWhen
    const answer = condition && answers[condition.field]
    const shown =
      condition === undefined ||
      (visible.has(condition.field) &&
        typeof answer === 'string' &&
        (typeof condition.equals === 'string'
          ? answer.trim() === condition.equals
          : condition.equals.includes(answer.trim())))

    if (shown) visible.add(item.id)
    return shown
  })
}
