'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WITHDRAWAL_REASON_MAX_LENGTH } from '@/domain/pipeline/withdrawal'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { withdrawCaregiverAction } from './actions'

export function WithdrawCaregiver({
  caregiverId,
  name,
}: {
  readonly caregiverId: string
  readonly name: string | null
}): ReactNode {
  const [state, formAction] = useActionState(withdrawCaregiverAction, {})
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const label = name ?? 'this caregiver'

  // showModal() would otherwise focus Close; this parent effect runs after Dialog's.
  useEffect(() => {
    const reason = formRef.current?.elements.namedItem('reason')
    if (open && reason instanceof HTMLInputElement) reason.focus()
  }, [open])

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Withdraw ${label}`}
        onClick={() => setOpen(true)}
      >
        Withdraw
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Withdraw ${label}`}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <TextField
            name="reason"
            label="Reason"
            required
            maxLength={WITHDRAWAL_REASON_MAX_LENGTH}
            hint="Recorded in this caregiver's pipeline history with your name and the time. Do not include medical or health details."
            error={state.reasonError}
          />
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingLabel="Withdrawing…">
              Withdraw caregiver
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
