'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { signOffClearanceAction } from './actions'

export function SignOffClearance({
  caregiverId,
  caregiverName,
}: {
  readonly caregiverId: string
  readonly caregiverName: string | null
}): ReactNode {
  const [state, formAction] = useActionState(signOffClearanceAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'

  return (
    <>
      <Button aria-label={`Sign off ${label}`} onClick={() => setOpen(true)}>
        Sign off
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sign off clearance">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <p className="text-sm text-ink">
            You are signing off {label} as cleared to work. This is recorded under your name with the time, records
            their credentials, and starts the AlayaCare sync.
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Signing off…">Sign off</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
