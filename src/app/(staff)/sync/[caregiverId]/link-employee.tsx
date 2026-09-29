'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { linkEmployeeAction } from './actions'

export function LinkEmployee({
  caregiverId,
  externalId,
}: {
  readonly caregiverId: string
  readonly externalId: string
}): ReactNode {
  const [state, formAction] = useActionState(linkEmployeeAction, {})

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <input type="hidden" name="caregiverId" value={caregiverId} />
      <input type="hidden" name="externalId" value={externalId} />
      <SubmitButton variant="secondary" pendingLabel="Linking…">
        Link to AlayaCare employee {externalId}
      </SubmitButton>
    </form>
  )
}
