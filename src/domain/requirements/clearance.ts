import { type BlockerCandidate, isOutstandingBlocker } from './blocker'

export type ClearanceReadiness<T extends BlockerCandidate = BlockerCandidate> =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: 'NO_REQUIREMENTS' }
  | { readonly ready: false; readonly reason: 'BLOCKING_OUTSTANDING'; readonly outstanding: readonly T[] }

// An empty set is not ready: a caregiver whose instances were never materialised must not read
// as cleared by vacuous truth (ADR-103). Stage is deliberately not an input.
export function clearanceReadiness<T extends BlockerCandidate>(
  instances: readonly T[],
): ClearanceReadiness<T> {
  if (instances.length === 0) return { ready: false, reason: 'NO_REQUIREMENTS' }

  const outstanding = instances.filter(isOutstandingBlocker)
  if (outstanding.length > 0) return { ready: false, reason: 'BLOCKING_OUTSTANDING', outstanding }

  return { ready: true }
}
