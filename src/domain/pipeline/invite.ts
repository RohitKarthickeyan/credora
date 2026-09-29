import { z } from 'zod'
import { PAYERS, SERVICE_TYPES, STATES } from '../requirements/vocabulary'
import { emailSchema } from '../validation/email'
import { personNameSchema } from '../validation/name'
import type { PipelineStage } from './stage'

// The source of truth for invite statuses. The Prisma enum `InviteStatus` mirrors this list,
// because src/domain may not import src/db (ARCHITECTURE.md § Layers); keep the two in step.
export const INVITE_STATUSES = ['QUEUED', 'SENT', 'REJECTED', 'CANCELLED'] as const
export type InviteStatus = (typeof INVITE_STATUSES)[number]

export const INVITE_CANCEL_REASONS = ['WITHDRAWN', 'ALREADY_STARTED', 'NO_EMAIL'] as const
export type InviteCancelReason = (typeof INVITE_CANCEL_REASONS)[number]

export const inviteCaregiverInputSchema = z.object({
  legalFirstName: personNameSchema.shape.first,
  legalLastName: personNameSchema.shape.last,
  email: emailSchema,
  workState: z.enum(STATES),
  serviceType: z.enum(SERVICE_TYPES, { error: 'Choose HHA or PCA.' }),
  payer: z.enum(PAYERS),
})

export type InviteCaregiverInput = z.output<typeof inviteCaregiverInputSchema>

// Checked when the email is sent, not when the invite is created: the caregiver may have signed
// in or been withdrawn while the job waited.
export function inviteSendRefusal(caregiver: {
  readonly stage: PipelineStage
  readonly email: string | null
}): InviteCancelReason | null {
  if (caregiver.stage === 'WITHDRAWN') return 'WITHDRAWN'
  if (caregiver.stage !== 'INVITED') return 'ALREADY_STARTED'
  if (caregiver.email === null) return 'NO_EMAIL'
  return null
}

export type InviteResendRefusal = InviteCancelReason | 'ALREADY_QUEUED'

// The send-time rule applied up front, so staff are told now rather than by a cancelled job.
export function inviteResendRefusal(state: {
  readonly stage: PipelineStage
  readonly email: string | null
  readonly latestInviteStatus: InviteStatus | null
}): InviteResendRefusal | null {
  return inviteSendRefusal(state) ?? (state.latestInviteStatus === 'QUEUED' ? 'ALREADY_QUEUED' : null)
}

export const correctEmailInputSchema = z.strictObject({
  caregiverId: z.string().min(1),
  email: emailSchema,
})
