'use client'

import { useActionState } from 'react'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { requestCode } from './actions'

export function EmailForm() {
  const [state, formAction] = useActionState(requestCode, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.email}
        error={state.error}
      />
      <SubmitButton pendingLabel="Sending…">Email me a code</SubmitButton>
    </form>
  )
}
