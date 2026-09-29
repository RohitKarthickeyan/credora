'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { CorrectEmailState } from './actions'
import { correctEmailAction } from './actions'

export function CorrectEmail({ caregiverId }: { readonly caregiverId: string }): ReactNode {
  const [open, setOpen] = useState(false)
  // Closed from the action, not an effect: react-hooks/set-state-in-effect forbids the latter.
  const [state, formAction] = useActionState(
    async (previous: CorrectEmailState, formData: FormData) => {
      const next = await correctEmailAction(previous, formData)
      if (next.saved) setOpen(false)
      return next
    },
    {},
  )
  const formRef = useRef<HTMLFormElement>(null)

  // showModal() would otherwise focus Close; this parent effect runs after Dialog's.
  useEffect(() => {
    const field = formRef.current?.elements.namedItem('email')
    if (open && field instanceof HTMLInputElement) field.focus()
  }, [open])

  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        Correct email
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Correct email">
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <TextField
            name="email"
            label="New email address"
            type="email"
            required
            hint="This is the address the caregiver signs in with."
            error={state.emailError}
          />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save email</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
