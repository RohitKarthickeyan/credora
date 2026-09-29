'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { recordManualCheckAction } from './actions'

export function RecordManualCheck({
  instanceId,
  caregiverName,
  requirementName,
}: {
  readonly instanceId: string
  readonly caregiverName: string | null
  readonly requirementName: string
}): ReactNode {
  const [state, formAction] = useActionState(recordManualCheckAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Record ${requirementName} for ${label}`}
        onClick={() => setOpen(true)}
      >
        Record
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Record ${requirementName}`}>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="instanceId" value={instanceId} />
          <p className="text-sm text-ink">
            You are recording that you performed {requirementName} for {label}. This satisfies the requirement
            and is recorded under your name with the time.
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Recording…">Record as done</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
