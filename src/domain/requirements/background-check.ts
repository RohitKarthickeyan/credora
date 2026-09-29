import { z } from 'zod'
import type { PipelineStage } from '../pipeline/stage'
import type { InstanceStatus } from './instance-status'
import { compareNames } from './manual-check'
import { DOCUMENT_KEYS } from './vocabulary'

export const BACKGROUND_CHECK_REQUIREMENT_KEY = 'BACKGROUND_CHECK'
export const BACKGROUND_CHECK_RESULT_EVIDENCE_KEY = 'BACKGROUND_CHECK_RESULT'

export const BACKGROUND_CHECK_ORDER_STATUSES = ['REQUESTED', 'ORDERED', 'PENDING', 'CLEAR', 'CONSIDER'] as const
export type BackgroundCheckOrderStatus = (typeof BACKGROUND_CHECK_ORDER_STATUSES)[number]
/** What a vendor can report. The port's BackgroundCheckStatus is structurally this; domain may not import it. */
type VendorReportedStatus = Exclude<BackgroundCheckOrderStatus, 'REQUESTED'>

// FCRA requires a standalone disclosure and consent signed before any check runs.
export function fcraConsentOnFile(signedDocuments: readonly { readonly templateKey: string }[]): boolean {
  return signedDocuments.some((document) => document.templateKey === DOCUMENT_KEYS.FCRA_DISCLOSURE)
}

export type BackgroundCheckOrderRefusal =
  | 'CAREGIVER_WITHDRAWN'
  | 'ALREADY_ORDERED'
  | 'NOT_OUTSTANDING'
  | 'FCRA_NOT_SIGNED'
  | 'NO_PACKAGE_CODE'
  | 'SUBJECT_INCOMPLETE'

export function backgroundCheckOrderRefusal(input: {
  readonly stage: PipelineStage
  readonly status: InstanceStatus
  readonly ordered: boolean
  readonly fcraSigned: boolean
  readonly packageCode: string | null
  readonly subjectComplete: boolean
}): BackgroundCheckOrderRefusal | null {
  if (input.stage === 'WITHDRAWN') return 'CAREGIVER_WITHDRAWN'
  if (input.ordered) return 'ALREADY_ORDERED'
  if (input.status !== 'NOT_STARTED') return 'NOT_OUTSTANDING'
  if (!input.fcraSigned) return 'FCRA_NOT_SIGNED'
  if (input.packageCode === null) return 'NO_PACKAGE_CODE'
  if (!input.subjectComplete) return 'SUBJECT_INCOMPLETE'
  return null
}

type OrderStatusChange =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'advance'; readonly to: VendorReportedStatus }
  | { readonly kind: 'conflict' }

const RANK: Readonly<Record<BackgroundCheckOrderStatus, number>> = {
  REQUESTED: 0,
  ORDERED: 1,
  PENDING: 2,
  CLEAR: 3,
  CONSIDER: 3,
}

export function isFinalOrderStatus(status: BackgroundCheckOrderStatus): boolean {
  return status === 'CLEAR' || status === 'CONSIDER'
}

// Status only moves forward; a vendor reversing one result into the other is for a person to see.
export function reconcileOrderStatus(
  current: BackgroundCheckOrderStatus,
  reported: VendorReportedStatus,
): OrderStatusChange {
  if (isFinalOrderStatus(current) && isFinalOrderStatus(reported) && current !== reported) {
    return { kind: 'conflict' }
  }
  return RANK[reported] > RANK[current] ? { kind: 'advance', to: reported } : { kind: 'unchanged' }
}

/** CLEAR satisfies; CONSIDER goes to a person. There is deliberately no failing status. */
export const RESULT_INSTANCE_STATUS = { CLEAR: 'SATISFIED', CONSIDER: 'IN_REVIEW' } as const satisfies Record<
  'CLEAR' | 'CONSIDER',
  InstanceStatus
>

export type BackgroundCheckRow = {
  readonly instanceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly status: InstanceStatus
  readonly fcraSigned: boolean
  readonly order: { readonly status: BackgroundCheckOrderStatus; readonly requestedAt: Date } | null
}

type BackgroundCheckState =
  | 'AWAITING_CONSENT'
  | 'READY_TO_ORDER'
  | 'IN_PROGRESS'
  | 'NEEDS_REVIEW'
  | 'FAILED_AFTER_REVIEW'
export type BackgroundCheckTask = BackgroundCheckRow & { readonly state: BackgroundCheckState }

function stateOf(row: BackgroundCheckRow): BackgroundCheckState {
  if (row.order?.status === 'CONSIDER') return row.status === 'EXCEPTION' ? 'FAILED_AFTER_REVIEW' : 'NEEDS_REVIEW'
  if (row.order !== null) return 'IN_PROGRESS'
  return row.fcraSigned ? 'READY_TO_ORDER' : 'AWAITING_CONSENT'
}

export function outstandingBackgroundChecks(rows: readonly BackgroundCheckRow[]): readonly BackgroundCheckTask[] {
  return rows
    .filter((row) => row.status !== 'SATISFIED' && row.status !== 'WAIVED')
    .map((row) => ({ ...row, state: stateOf(row) }))
    .sort((a, b) => compareNames(a.caregiverName, b.caregiverName) || a.instanceId.localeCompare(b.instanceId))
}

export const orderBackgroundCheckRequestSchema = z.strictObject({
  instanceId: z.string().min(1),
})

const BACKGROUND_CHECK_ADJUDICATIONS = ['CLEARED_AFTER_REVIEW', 'FAILED_AFTER_REVIEW'] as const
export type BackgroundCheckAdjudication = (typeof BACKGROUND_CHECK_ADJUDICATIONS)[number]

/** A person's decision on a CONSIDER result. A fail blocks clearance; it never withdraws anyone. */
export const ADJUDICATION_INSTANCE_STATUS = {
  CLEARED_AFTER_REVIEW: 'SATISFIED',
  FAILED_AFTER_REVIEW: 'EXCEPTION',
} as const satisfies Record<BackgroundCheckAdjudication, InstanceStatus>

export type BackgroundCheckAdjudicationRefusal = 'CAREGIVER_WITHDRAWN' | 'NOT_AWAITING_REVIEW'

// IN_REVIEW alone does not prove a CONSIDER; the vendor's status is what the decision is about.
// A decision is final (OPEN-QUESTIONS 219), so a decided instance is no longer awaiting review.
export function backgroundCheckAdjudicationRefusal(input: {
  readonly stage: PipelineStage
  readonly status: InstanceStatus
  readonly orderStatus: BackgroundCheckOrderStatus | null
}): BackgroundCheckAdjudicationRefusal | null {
  if (input.stage === 'WITHDRAWN') return 'CAREGIVER_WITHDRAWN'
  if (input.status !== 'IN_REVIEW' || input.orderStatus !== 'CONSIDER') return 'NOT_AWAITING_REVIEW'
  return null
}

export const adjudicateBackgroundCheckRequestSchema = z.strictObject({
  instanceId: z.string().min(1),
  adjudication: z.enum(BACKGROUND_CHECK_ADJUDICATIONS),
})
