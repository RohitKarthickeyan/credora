'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { verifySecondFactor } from '../actions'

export function SecondFactorForm() {
  const [state, formAction] = useActionState(verifySecondFactor, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <TextField
        name="code"
        label="Code"
        autoComplete="one-time-code"
        autoFocus
        required
        hint="Or enter one of your recovery codes."
      />
      <SubmitButton pendingLabel="Checking…">Verify</SubmitButton>
    </form>
  )
}
