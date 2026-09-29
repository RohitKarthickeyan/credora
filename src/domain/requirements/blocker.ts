import type { InstanceStatus } from './instance-status'

// The instance that got furthest before stopping, the actionable failure first. WAIVED is
// outstanding only because clearance counts only SATISFIED (OPEN-QUESTIONS 38), and nothing can
// move it, so it is shown only when nothing else is.
const BLOCKER_PRECEDENCE: readonly InstanceStatus[] = [
  'EXCEPTION',
  'EXPIRED',
  'IN_REVIEW',
  'PENDING',
  'NOT_STARTED',
  'WAIVED',
]

export type BlockerCandidate = {
  readonly templateKey: string
  readonly name: string
  readonly status: InstanceStatus
  readonly blocksClearance: boolean
}

export type CurrentBlocker<T extends BlockerCandidate = BlockerCandidate> = {
  readonly blocker: T
  readonly outstanding: number
}

function precedes(a: BlockerCandidate, b: BlockerCandidate): boolean {
  const rank = BLOCKER_PRECEDENCE.indexOf(a.status) - BLOCKER_PRECEDENCE.indexOf(b.status)
  // Code-point order, not localeCompare: the key is stable across template versions and locales.
  return rank !== 0 ? rank < 0 : a.templateKey < b.templateKey
}

export function isOutstandingBlocker(
  instance: Pick<BlockerCandidate, 'status' | 'blocksClearance'>,
): boolean {
  return instance.blocksClearance && instance.status !== 'SATISFIED'
}

export function currentBlocker<T extends BlockerCandidate>(
  instances: readonly T[],
): CurrentBlocker<T> | null {
  const outstanding = instances.filter(isOutstandingBlocker)
  const [first, ...rest] = outstanding
  if (first === undefined) return null

  const blocker = rest.reduce((best, candidate) => (precedes(candidate, best) ? candidate : best), first)
  return { blocker, outstanding: outstanding.length }
}
