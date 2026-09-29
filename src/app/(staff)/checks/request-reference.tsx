'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { REFERENCE_RESPONSE_WINDOW_HOURS } from '@/domain/requirements/reference-check'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { requestReferenceAction } from './reference-actions'

const WINDOW_DAYS = REFERENCE_RESPONSE_WINDOW_HOURS / 24

export function RequestReference({
  referenceId,
  referenceName,
  caregiverName,
}: {
  readonly referenceId: string
  readonly referenceName: string
  readonly caregiverName: string | null
}): ReactNode {
  const [state, formAction] = useActionState(requestReferenceAction, {})
  const [open, setOpen] = useState(false)
  const caregiver = caregiverName ?? 'this caregiver'

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Send reference request to ${referenceName}`}
        onClick={() => setOpen(true)}
      >
        Send request
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send reference request">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="referenceId" value={referenceId} />
          <p className="text-sm text-ink">
            {`Credora will email ${referenceName} a short reference form for ${caregiver}. If they do not answer within ${WINDOW_DAYS} days it asks once more, then passes it back to you.`}
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
