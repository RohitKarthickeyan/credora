'use server'

import { redirect } from 'next/navigation'
import { staffCredentialsSchema } from '@/domain/auth/credentials'
import type { MfaRefusal } from '@/domain/auth/mfa'
import { secondFactorCodeSchema, totpCodeSchema } from '@/domain/auth/mfa'
import {
  confirmStaffMfaEnrolment,
  signInStaff,
  signOutStaff,
  verifyStaffSecondFactor,
} from '@/server/auth/session'
import { pathAfterSignIn } from './sign-in-path'

export type SignInState = { readonly error?: string; readonly email?: string }
type SecondFactorState = { readonly error?: string }
type EnrolmentState = { readonly error?: string; readonly recoveryCodes?: readonly string[] }

// One message for every failure, a malformed email included, so the form cannot be used to
// learn who has an account.
const SIGN_IN_FAILED = "That email and password don't match an active staff account."

const MFA_REFUSALS: Record<Exclude<MfaRefusal, 'NO_CHALLENGE'>, string> = {
  WRONG_CODE: "That code didn't work. Check your authenticator app and try again.",
  LOCKED: 'Too many wrong codes. Ask your agency admin to reset your two-step sign-in.',
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get('email')
  const credentials = staffCredentialsSchema.safeParse({
    email,
    password: formData.get('password'),
  })

  const result = credentials.success ? await signInStaff(credentials.data) : 'FAILED'
  if (result === 'FAILED') {
    return { error: SIGN_IN_FAILED, email: typeof email === 'string' ? email : undefined }
  }
  redirect(pathAfterSignIn(result))
}

export async function verifySecondFactor(
  _previous: SecondFactorState,
  formData: FormData,
): Promise<SecondFactorState> {
  const code = secondFactorCodeSchema.safeParse(formData.get('code'))
  if (!code.success) return { error: code.error.issues[0]?.message }

  const result = await verifyStaffSecondFactor(code.data)
  if (result.ok) redirect('/')
  if (result.refusal === 'NO_CHALLENGE') redirect('/login')
  return { error: MFA_REFUSALS[result.refusal] }
}

// No redirect on success: the recovery codes render once, from this state, on the same page.
export async function confirmMfaEnrolment(
  _previous: EnrolmentState,
  formData: FormData,
): Promise<EnrolmentState> {
  const code = totpCodeSchema.safeParse(formData.get('code'))
  if (!code.success) return { error: code.error.issues[0]?.message }

  const result = await confirmStaffMfaEnrolment(code.data)
  if (result.ok) return { recoveryCodes: result.recoveryCodes }
  if (result.refusal === 'NO_CHALLENGE') redirect('/login')
  return { error: MFA_REFUSALS[result.refusal] }
}

export async function signOut(): Promise<void> {
  await signOutStaff()
  redirect('/login')
}
