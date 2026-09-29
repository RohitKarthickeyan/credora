'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { prepareDocuments } from '../actions'

export function PrepareForm() {
  const [state, formAction] = useActionState(prepareDocuments, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <SubmitButton pendingLabel="Preparing…">Prepare my documents</SubmitButton>
    </form>
  )
}
