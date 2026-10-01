import { z } from 'zod'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'

// The two lists below are the source of truth for the Prisma enums `StaffDecision` and
// `CaregiverNoticeStatus`; keep each pair in step.
export const STAFF_DECISIONS = ['ACCEPTED', 'REJECTED', 'REUPLOAD_REQUESTED'] as const
export type StaffDecision = (typeof STAFF_DECISIONS)[number]
export const RETURN_DECISIONS = ['REJECTED', 'REUPLOAD_REQUESTED'] as const satisfies readonly StaffDecision[]
export type ReturnDecision = (typeof RETURN_DECISIONS)[number]

export const CAREGIVER_NOTICE_STATUSES = ['QUEUED', 'SENT', 'REJECTED', 'NO_EMAIL', 'CANCELLED'] as const
export type CaregiverNoticeStatus = (typeof CAREGIVER_NOTICE_STATUSES)[number]

/** What the queue's form submits; WAIVED routes to the waive use case. */
export const QUEUE_DECISIONS = [...STAFF_DECISIONS, 'WAIVED'] as const
export type QueueDecision = (typeof QUEUE_DECISIONS)[number]
export const queueDecisionInputSchema = z.object({
  instanceId: z.uuid(),
  uploadedDocumentId: z.uuid(),
  decision: z.enum(QUEUE_DECISIONS),
})

export type DecisionTarget = {
  readonly stage: PipelineStage
  readonly instanceStatus: InstanceStatus
  // Its review sent it to staff and set the instance to EXCEPTION; a document returned to the caregiver is not (ADR-164).
  readonly flagged: boolean
  readonly decided: boolean
  // No later UPLOADED_DOCUMENT evidence on the instance.
  readonly latestUpload: boolean
}

export function isWaivable(target: Pick<DecisionTarget, 'stage' | 'instanceStatus'>): boolean {
  return target.stage !== 'WITHDRAWN' && target.instanceStatus === 'EXCEPTION'
}

/** The queue item is still what staff saw: flagged, undecided, current, instance EXCEPTION, caregiver not withdrawn. */
export function isDecidable(target: DecisionTarget): boolean {
  return isWaivable(target) && target.flagged && !target.decided && target.latestUpload
}

export type NoticeTarget = {
  readonly stage: PipelineStage
  readonly instanceStatus: InstanceStatus
  readonly email: string | null
}

/**
 * Why a queued caregiver email is not sent, or null to send it. A withdrawn caregiver or an
 * instance no longer EXCEPTION (re-uploaded, or waived) needs no email.
 */
export function caregiverNoticeRefusal(
  target: NoticeTarget,
): Extract<CaregiverNoticeStatus, 'CANCELLED' | 'NO_EMAIL'> | null {
  if (!isWaivable(target)) return 'CANCELLED'
  if (target.email === null) return 'NO_EMAIL'
  return null
}
