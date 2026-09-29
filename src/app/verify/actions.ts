'use server'

import { redirect } from 'next/navigation'
import { oneTimeCodeSchema } from '@/domain/auth/one-time-code'
import { emailSchema } from '@/domain/validation/email'
import { getPort } from '@/integrations/registry'
import {
  requestCaregiverCode,
  signOutCaregiver,
  verifyCaregiverCode,
} from '@/server/auth/caregiver-session'

// Intake is what a signed-in caregiver has left to do; its overview says what is still missing.
const CAREGIVER_HOME = '/intake'

export type RequestCodeState = { readonly error?: string; readonly email?: string }

export type VerifyCodeState = { readonly error?: string }

export async function requestCode(
  _previous: RequestCodeState,
  formData: FormData,
): Promise<RequestCodeState> {
  const email = formData.get('email')
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message,
      email: typeof email === 'string' ? email : undefined,
    }
  }

  await requestCaregiverCode({ email: parsed.data }, getPort('messaging'))
  // Always, whatever happened: the response must not tell a registered address from any other.
  redirect('/verify/code')
}

// One copy for every refusal: telling them apart would tell a registered address from any other.
const REFUSED = "That code didn't work. Check the email and try again, or ask for a new code."

export async function verifyCode(
  _previous: VerifyCodeState,
  formData: FormData,
): Promise<VerifyCodeState> {
  const code = oneTimeCodeSchema.safeParse(formData.get('code'))
  if (!code.success) return { error: 'Enter the 6-digit code from the email.' }

  const result = await verifyCaregiverCode(code.data)
  if (!result.ok) return { error: REFUSED }
  redirect(CAREGIVER_HOME)
}

export async function signOut(): Promise<void> {
  await signOutCaregiver()
  redirect('/verify')
}
