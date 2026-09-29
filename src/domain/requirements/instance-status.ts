// The source of truth for the instance status names. The Prisma enum `InstanceStatus` mirrors
// this list, because src/domain may not import src/db (ARCHITECTURE.md § Layers);
// keep the two in step.
export const INSTANCE_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'IN_REVIEW',
  'SATISFIED',
  'EXCEPTION',
  'WAIVED',
  'EXPIRED',
] as const

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number]

export type InstanceStatusTransition = {
  readonly from: InstanceStatus
  readonly to: InstanceStatus
}

// Keyed by (from, to), not by event: an instance has many callers that each know the target
// status, and no history model reads a cause. WAIVED has no outbound edge (OPEN-QUESTIONS #38).
// SATISFIED → EXCEPTION is weekly sampling finding an auto-accepted record invalid.
const INSTANCE_STATUS_TRANSITIONS: readonly InstanceStatusTransition[] = [
  { from: 'NOT_STARTED', to: 'PENDING' },
  { from: 'NOT_STARTED', to: 'IN_REVIEW' },
  { from: 'NOT_STARTED', to: 'WAIVED' },
  { from: 'PENDING', to: 'IN_REVIEW' },
  { from: 'PENDING', to: 'SATISFIED' },
  { from: 'PENDING', to: 'WAIVED' },
  { from: 'IN_REVIEW', to: 'SATISFIED' },
  { from: 'IN_REVIEW', to: 'EXCEPTION' },
  { from: 'IN_REVIEW', to: 'WAIVED' },
  { from: 'EXCEPTION', to: 'SATISFIED' },
  { from: 'EXCEPTION', to: 'PENDING' },
  { from: 'EXCEPTION', to: 'WAIVED' },
  { from: 'SATISFIED', to: 'EXPIRED' },
  { from: 'SATISFIED', to: 'EXCEPTION' },
  { from: 'EXPIRED', to: 'PENDING' },
  { from: 'EXPIRED', to: 'IN_REVIEW' },
  { from: 'EXPIRED', to: 'WAIVED' },
]

export type InstanceTransitionRefusal = 'ALREADY_IN_STATUS' | 'ILLEGAL_TRANSITION' | 'NO_EVIDENCE'

export type InstanceTransitionResult =
  | { readonly ok: true; readonly from: InstanceStatus; readonly to: InstanceStatus }
  | {
      readonly ok: false
      readonly from: InstanceStatus
      readonly to: InstanceStatus
      readonly refusal: InstanceTransitionRefusal
    }

/**
 * ALREADY_IN_STATUS comes first so a redelivered "satisfied" is idempotent even when nothing is
 * linked yet. SATISFIED with no evidence would be a clearance with no proof.
 */
export function transitionInstanceStatus(
  from: InstanceStatus,
  to: InstanceStatus,
  evidence: { readonly hasEvidence: boolean },
): InstanceTransitionResult {
  if (from === to) return { ok: false, from, to, refusal: 'ALREADY_IN_STATUS' }

  if (!INSTANCE_STATUS_TRANSITIONS.some((edge) => edge.from === from && edge.to === to)) {
    return { ok: false, from, to, refusal: 'ILLEGAL_TRANSITION' }
  }

  if (to === 'SATISFIED' && !evidence.hasEvidence) {
    return { ok: false, from, to, refusal: 'NO_EVIDENCE' }
  }

  return { ok: true, from, to }
}
