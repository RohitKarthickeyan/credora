'use server'

import { revalidatePath } from 'next/cache'
import type { RevealSensitiveFieldState } from '@/app/_components/sensitive'
import { revealSensitiveFieldInputSchema } from '@/domain/masking/sensitive-field'
import { correctEmailInputSchema } from '@/domain/pipeline/invite'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import type { CorrectEmailResult } from '@/server/caregivers/correct-email'
import { correctEmail } from '@/server/caregivers/correct-email'
import type { ResendInviteResult } from '@/server/caregivers/resend-invite'
import { resendInvite } from '@/server/caregivers/resend-invite'
import { revealSensitiveField } from '@/server/caregivers/reveal-sensitive-field'
import { sendStaffText, setConversationPaused } from '@/server/conversation/staff'
import type { VoidEnvelopeResult } from '@/server/forms/void-envelope'
import { voidEnvelope } from '@/server/forms/void-envelope'

type ResendInviteState = { readonly error?: string; readonly sent?: true }
export type CorrectEmailState = {
  readonly error?: string
  readonly emailError?: string
  readonly saved?: true
}
type VoidEnvelopeState = { readonly error?: string }

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

export async function pauseConversationAction(caregiverId: string, paused: boolean): Promise<void> {
  const { principal } = await requireStaffSession()
  await runAsPrincipal(principal, {}, () => setConversationPaused({ caregiverId, paused }))
  revalidatePath(`/caregivers/${caregiverId}`)
}

export async function sendStaffTextAction(caregiverId: string, formData: FormData): Promise<void> {
  const { principal } = await requireStaffSession()
  await runAsPrincipal(principal, {}, () =>
    sendStaffText({ caregiverId, body: text(formData, 'body') }),
  )
  revalidatePath(`/caregivers/${caregiverId}`)
}
