'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { resendInviteAction } from './actions'

export function ResendInvite({ caregiverId }: { readonly caregiverId: string }): ReactNode {
  const [state, formAction] = useActionState(resendInviteAction, {})

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      {state.sent ? (
        <Alert tone="success" live>
          A new invite email is queued. The old link stops working once it is sent.
        </Alert>
      ) : null}
      <input type="hidden" name="caregiverId" value={caregiverId} />
      <SubmitButton variant="secondary" pendingLabel="Queuing…">
        Resend invite
      </SubmitButton>
    </form>
  )
}
