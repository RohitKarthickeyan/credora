'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import type { RetireState } from './actions'

export function RetireTemplate({
  action,
}: {
  action: (previous: RetireState, formData: FormData) => Promise<RetireState>
}) {
  const [state, formAction] = useActionState(action, {})

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <SubmitButton variant="ghost" size="sm" pendingLabel="Withdrawing…">
        Withdraw
      </SubmitButton>
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
    </form>
  )
}
