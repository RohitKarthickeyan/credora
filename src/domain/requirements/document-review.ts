import { type BlockerCandidate, isOutstandingBlocker } from './blocker'
import type { RequirementType } from './template'

type DocumentReviewInstance = Pick<BlockerCandidate, 'status' | 'blocksClearance'> & {
  readonly type: RequirementType
}

/**
 * Done when the caregiver has requirement instances and no blocking DOCUMENT one is outstanding.
 * An empty set is not done: instances never materialised must not read as reviewed (ADR-111).
 */
export function documentReviewCleared(instances: readonly DocumentReviewInstance[]): boolean {
  return (
    instances.length > 0 &&
    !instances.some((instance) => instance.type === 'DOCUMENT' && isOutstandingBlocker(instance))
  )
}
