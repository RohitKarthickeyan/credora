'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { verifyCode } from '../actions'

export function CodeForm() {
  const [state, formAction] = useActionState(verifyCode, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <TextField
        name="code"
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      <SubmitButton pendingLabel="Checking…">Sign in</SubmitButton>
    </form>
  )
}
