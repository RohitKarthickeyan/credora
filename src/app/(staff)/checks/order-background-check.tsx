'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { orderBackgroundCheckAction } from './actions'

export function OrderBackgroundCheck({
  instanceId,
  caregiverName,
}: {
  readonly instanceId: string
  readonly caregiverName: string | null
}): ReactNode {
  const [state, formAction] = useActionState(orderBackgroundCheckAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Order background check for ${label}`}
        onClick={() => setOpen(true)}
      >
        Order check
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Order background check">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="instanceId" value={instanceId} />
          <p className="text-sm text-ink">
            {`${label} has signed the standalone FCRA disclosure. The check is ordered from the agency's vendor under your name, and the result arrives here.`}
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Ordering…">Order check</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
