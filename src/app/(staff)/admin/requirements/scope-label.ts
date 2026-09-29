import type { ResolutionContext } from '@/domain/requirements/resolve'
import { SCOPE_AXES, type ScopeAxis, type TemplateScope } from '@/domain/requirements/scope'

// "role" is spelled out because HHA and PCA are both service types and roles. The agency is
// always the viewer's own, so its id is never printed.
const AXIS_LABEL: Record<ScopeAxis, (value: string) => string> = {
  state: (value) => value,
  serviceType: (value) => value,
  payer: (value) => value,
  agencyId: () => 'your agency',
  role: (value) => `role ${value}`,
}

export function scopeLabel(scope: TemplateScope | ResolutionContext): string {
  const axes: TemplateScope = scope
  const parts = SCOPE_AXES.flatMap((axis) => {
    const value = axes[axis]
    return value === null || value === undefined ? [] : [AXIS_LABEL[axis](value)]
  })
  return parts.length === 0 ? 'any caregiver' : parts.join(' · ')
}
