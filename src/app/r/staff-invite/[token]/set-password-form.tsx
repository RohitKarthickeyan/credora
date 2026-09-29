'use client'

import { useActionState } from 'react'
import { NEW_PASSWORD_MIN_LENGTH } from '@/domain/auth/staff-user'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { setStaffPassword } from './actions'

export function SetPasswordForm({ token, email }: { readonly token: string; readonly email: string }) {
  const [state, formAction] = useActionState(setStaffPassword.bind(null, token), {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      {/* Present for password managers, which save the address with the new password. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        defaultValue={email}
        readOnly
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        hint={`At least ${NEW_PASSWORD_MIN_LENGTH} characters.`}
        required
      />
      <TextField
        name="confirm"
        type="password"
        label="Type it again"
        autoComplete="new-password"
        required
      />
      <SubmitButton pendingLabel="Saving…" className="w-full">
        Set password and sign in
      </SubmitButton>
    </form>
  )
}
