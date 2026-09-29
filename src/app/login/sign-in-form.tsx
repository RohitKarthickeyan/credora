'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { signIn } from './actions'

export function SignInForm() {
  const [state, formAction] = useActionState(signIn, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.email}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  )
}
