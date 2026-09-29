'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { voidEnvelopeAction } from './actions'

export function VoidEnvelope({ caregiverId }: { readonly caregiverId: string }): ReactNode {
  const [state, formAction] = useActionState(voidEnvelopeAction, {})
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        Void envelope
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Void this envelope?">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <p>
            The caregiver&apos;s unsigned documents are cancelled at the e-signature provider. They
            will need to prepare and sign a fresh set.
          </p>
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingLabel="Voiding…">
              Void envelope
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
