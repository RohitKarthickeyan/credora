'use server'

import { redirect } from 'next/navigation'
import { pathAfterSignIn } from '@/app/login/sign-in-path'
import { newPasswordSchema } from '@/domain/auth/staff-user'
import { signInStaff } from '@/server/auth/session'
import { acceptStaffInvite } from '@/server/users/staff-invite-link'

export type SetPasswordState = { readonly error?: string }

// The password is never echoed back in the state.
export async function setStaffPassword(
  token: string,
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = newPasswordSchema.safeParse(formData.get('password'))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  if (formData.get('confirm') !== parsed.data) return { error: "The two passwords don't match." }

  const result = await acceptStaffInvite(token, { password: parsed.data })
  // The page itself explains an invalid, expired or used link.
  if (!result.ok) redirect(`/r/staff-invite/${token}`)
  if (result.value.status === 'NOT_PENDING') return { error: 'This invite is no longer active.' }

  redirect(pathAfterSignIn(await signInStaff({ email: result.value.email, password: parsed.data })))
}
