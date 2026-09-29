import { type PipelineStage } from './stage'

export const PIPELINE_EVENT_TYPES = [
  'INTAKE_STARTED',
  'INTAKE_SUBMITTED',
  'ENVELOPE_COMPLETED',
  'DOCUMENT_REVIEW_CLEARED',
  'VERIFICATION_COMPLETED',
  'CLEARANCE_GRANTED',
  'SYNC_COMPLETED',
  'WITHDRAWAL_RECORDED',
] as const

export type PipelineEventType = (typeof PIPELINE_EVENT_TYPES)[number]

export type PipelineTransition = {
  from: PipelineStage
  event: PipelineEventType
  to: PipelineStage
}

// The whole table; a fifteenth edge is a product decision, not a line in this array. Edges are
// keyed by (from, event) rather than (from, to) because the event is what a PipelineEvent
// records and what a metric counts. There are no backward edges: rework is a requirement
// instance in EXCEPTION worked from the exception queue, not a stage regression, so a caregiver
// never occupies a stage twice and every duration stays a single interval.
const PIPELINE_TRANSITIONS: readonly PipelineTransition[] = [
  { from: 'INVITED', event: 'INTAKE_STARTED', to: 'INTAKE' },
  { from: 'INTAKE', event: 'INTAKE_SUBMITTED', to: 'SIGNING' },
  { from: 'SIGNING', event: 'ENVELOPE_COMPLETED', to: 'DOCUMENT_REVIEW' },
  { from: 'DOCUMENT_REVIEW', event: 'DOCUMENT_REVIEW_CLEARED', to: 'VERIFICATION' },
  { from: 'VERIFICATION', event: 'VERIFICATION_COMPLETED', to: 'CLEARANCE' },
  { from: 'CLEARANCE', event: 'CLEARANCE_GRANTED', to: 'SYNCING' },
  { from: 'SYNCING', event: 'SYNC_COMPLETED', to: 'ACTIVE' },
  { from: 'INVITED', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'INTAKE', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'SIGNING', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'DOCUMENT_REVIEW', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'VERIFICATION', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'CLEARANCE', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
  { from: 'SYNCING', event: 'WITHDRAWAL_RECORDED', to: 'WITHDRAWN' },
]

type TransitionRefusal = 'ALREADY_APPLIED' | 'TERMINAL_STAGE' | 'ILLEGAL_TRANSITION'

export type TransitionResult =
  | { ok: true; from: PipelineStage; event: PipelineEventType; to: PipelineStage }
  | { ok: false; from: PipelineStage; event: PipelineEventType; refusal: TransitionRefusal }

/**
 * Classifies a move. A refusal is a return value, not a throw: all three outcomes are expected
 * and each has a different correct response (CONVENTIONS.md § Error handling).
 *
 * ALREADY_APPLIED is tested before terminality on purpose. The e-sign webhook and the sync
 * worker are at-least-once, so `transition('ACTIVE', 'SYNC_COMPLETED')` is a redelivery, not an
 * error; the caller treats it as success and writes no PipelineEvent, which is what keeps a
 * zero-length stage occupancy out of every duration report.
 */
export function transition(from: PipelineStage, event: PipelineEventType): TransitionResult {
  if (PIPELINE_TRANSITIONS.find((edge) => edge.event === event)?.to === from) {
    return { ok: false, from, event, refusal: 'ALREADY_APPLIED' }
  }

  const edge = PIPELINE_TRANSITIONS.find((e) => e.from === from && e.event === event)
  if (edge !== undefined) return { ok: true, from, event, to: edge.to }

  if (isTerminal(from)) return { ok: false, from, event, refusal: 'TERMINAL_STAGE' }
  return { ok: false, from, event, refusal: 'ILLEGAL_TRANSITION' }
}

export function isTerminal(stage: PipelineStage): boolean {
  return !PIPELINE_TRANSITIONS.some((edge) => edge.from === stage)
}
