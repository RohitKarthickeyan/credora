'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { RevealSensitiveFieldState } from '@/app/_components/sensitive'
import { revealSensitiveFieldInputSchema } from '@/domain/masking/sensitive-field'
import { correctEmailInputSchema } from '@/domain/pipeline/invite'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import type { CorrectEmailResult } from '@/server/caregivers/correct-email'
import { correctEmail } from '@/server/caregivers/correct-email'
import type { ResendInviteResult } from '@/server/caregivers/resend-invite'
import { resendInvite } from '@/server/caregivers/resend-invite'
import { completeBackgroundCheck } from '@/server/verification/complete-background-check'
import { revealSensitiveField } from '@/server/caregivers/reveal-sensitive-field'
import { type SignOffResult, signOffClearance } from '@/server/clearance/sign-off'
import { sendStaffText, setConversationPaused } from '@/server/conversation/staff'
import type { VoidEnvelopeResult } from '@/server/forms/void-envelope'
import { voidEnvelope } from '@/server/forms/void-envelope'
import {
  type RecordHealthScreeningResultResult,
  recordHealthScreeningResult,
} from '@/server/verification/health-screening'

type ResendInviteState = { readonly error?: string; readonly sent?: true }
export type CorrectEmailState = {
  readonly error?: string
  readonly emailError?: string
  readonly saved?: true
}
type VoidEnvelopeState = { readonly error?: string }
type CompleteBackgroundCheckState = { readonly error?: string }

const NOT_FOUND = 'This caregiver could not be found.'

const RESEND_REFUSALS = {
  NOT_FOUND,
  WITHDRAWN: 'This caregiver has been withdrawn.',
  ALREADY_STARTED: 'This caregiver has already signed in, so there is no invite to resend.',
  NO_EMAIL: 'There is no email address on record. Correct it first.',
  ALREADY_QUEUED: 'An invite is already waiting to be sent.',
} as const satisfies Record<Extract<ResendInviteResult, { ok: false }>['reason'], string>

const CORRECT_REFUSALS = {
  NOT_FOUND,
  UNCHANGED: "This is already the caregiver's email address.",
  EMAIL_IN_USE: 'A caregiver in your agency already has this email address.',
} as const satisfies Record<Extract<CorrectEmailResult, { ok: false }>['reason'], string>

const VOID_REFUSALS = {
  NOT_VOIDABLE: 'There is no envelope out for signing to void.',
  CHANGED_AT_PROVIDER:
    'The caregiver has just signed or declined this envelope. Refresh the page.',
} as const satisfies Record<Extract<VoidEnvelopeResult, { ok: false }>['reason'], string>

const COMPLETE_CHECK_REFUSALS = {
  NOT_DEMO: 'Only demo caregivers can be cleared this way.',
  NOT_READY: 'This caregiver is not waiting on the background check. Refresh the page.',
  FCRA_NOT_SIGNED: 'The FCRA disclosure has not been signed.',
} as const satisfies Record<Extract<Awaited<ReturnType<typeof completeBackgroundCheck>>, { ok: false }>['reason'], string>

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function revealSensitiveFieldAction(
  _previous: RevealSensitiveFieldState,
  formData: FormData,
): Promise<RevealSensitiveFieldState> {
  const { principal } = await requireStaffSession()
  // No revalidatePath: a reveal writes only an audit row, and no screen renders audit rows.
  const parsed = revealSensitiveFieldInputSchema.safeParse({
    caregiverId: formData.get('caregiverId'),
    field: formData.get('field'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { status: 'invalid', message: 'Enter the reason you need to see this value.' }
  }
  return runAsPrincipal(principal, {}, () => revealSensitiveField(parsed.data))
}

export async function resendInviteAction(
  _previous: ResendInviteState,
  formData: FormData,
): Promise<ResendInviteState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () => resendInvite({ caregiverId }))
  if (!result.ok) return { error: RESEND_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${caregiverId}`)
  return { sent: true }
}

export async function correctEmailAction(
  _previous: CorrectEmailState,
  formData: FormData,
): Promise<CorrectEmailState> {
  const { principal } = await requireStaffSession()
  const values = {
    caregiverId: text(formData, 'caregiverId'),
    email: text(formData, 'email'),
  }
  const parsed = correctEmailInputSchema.safeParse(values)
  if (!parsed.success) {
    const issue = parsed.error.issues.find(({ path }) => path[0] === 'email')
    if (issue !== undefined) return { emailError: issue.message }
  }

  const result = await runAsPrincipal(principal, {}, () => correctEmail(values))
  if (!result.ok) return { error: CORRECT_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${values.caregiverId}`)
  return { saved: true }
}

export async function voidEnvelopeAction(
  _previous: VoidEnvelopeState,
  formData: FormData,
): Promise<VoidEnvelopeState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () => voidEnvelope({ caregiverId }))
  if (!result.ok) return { error: VOID_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${caregiverId}`)
  return {}
}

type ConversationState = { readonly error?: string; readonly sent?: true }

const pauseConversationSchema = z.object({
  caregiverId: z.string().min(1),
  paused: z.enum(['true', 'false']).transform((value) => value === 'true'),
})

const sendStaffTextSchema = z.object({
  caregiverId: z.string().min(1),
  body: z.string().trim().min(1).max(1600),
  idempotencyKey: z.string().min(1),
})

export async function pauseConversationAction(
  _previous: ConversationState,
  formData: FormData,
): Promise<ConversationState> {
  const { principal } = await requireStaffSession()
  const parsed = pauseConversationSchema.safeParse({
    caregiverId: formData.get('caregiverId'),
    paused: formData.get('paused'),
  })
  if (!parsed.success) return { error: 'This request could not be read. Refresh the page.' }

  await runAsPrincipal(principal, {}, () => setConversationPaused(parsed.data))
  revalidatePath(`/caregivers/${parsed.data.caregiverId}`)
  return {}
}

export async function sendStaffTextAction(
  _previous: ConversationState,
  formData: FormData,
): Promise<ConversationState> {
  const { principal } = await requireStaffSession()
  const parsed = sendStaffTextSchema.safeParse({
    caregiverId: formData.get('caregiverId'),
    body: formData.get('body'),
    idempotencyKey: formData.get('idempotencyKey'),
  })
  if (!parsed.success) return { error: 'Enter a message of up to 1600 characters.' }

  const result = await runAsPrincipal(principal, {}, () => sendStaffText(parsed.data))
  if (!result.ok) return { error: "Don't send a Social Security number by text." }
  revalidatePath(`/caregivers/${parsed.data.caregiverId}`)
  return { sent: true }
}

export async function completeBackgroundCheckAction(
  _previous: CompleteBackgroundCheckState,
  formData: FormData,
): Promise<CompleteBackgroundCheckState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () => completeBackgroundCheck({ caregiverId }))
  if (!result.ok) return { error: COMPLETE_CHECK_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${caregiverId}`)
  return {}
}

type SignOffState = { readonly error?: string }

const SIGN_OFF_REFUSALS: Record<Extract<SignOffResult, { ok: false }>['reason'], string> = {
  NO_REQUIREMENTS: 'No requirements are assigned to this caregiver yet.',
  BLOCKING_OUTSTANDING: 'A blocking requirement is no longer satisfied. Reload to see which.',
  NOT_IN_CLEARANCE:
    'This caregiver is not waiting for sign-off. They may already have been signed off or withdrawn.',
}

export async function signOffClearanceAction(_previous: SignOffState, formData: FormData): Promise<SignOffState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () => signOffClearance({ caregiverId }))
  if (!result.ok) return { error: SIGN_OFF_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${caregiverId}`)
  return {}
}

type RecordResultState = { readonly error?: string }

const RESULT_REFUSALS: Record<Extract<RecordHealthScreeningResultResult, { ok: false }>['reason'], string> = {
  NOT_AWAITING_RESULT: 'This requirement is not waiting for a result. Reload to see its status.',
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
}

export async function recordHealthScreeningResultAction(
  _previous: RecordResultState,
  formData: FormData,
): Promise<RecordResultState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () =>
    recordHealthScreeningResult({
      instanceId: text(formData, 'instanceId'),
      outcome: text(formData, 'outcome'),
      resultedOn: text(formData, 'resultedOn'),
    }),
  )
  if (!result.ok) return { error: RESULT_REFUSALS[result.reason] }

  revalidatePath(`/caregivers/${caregiverId}`)
  return {}
}
