'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { DateField } from '@/ui/date-field'
import { Dialog } from '@/ui/dialog'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { recordHealthScreeningResultAction } from './actions'

const OUTCOMES = [
  { value: 'PASS', label: 'Passed' },
  { value: 'FAIL', label: 'Failed' },
] as const

export function RecordHealthScreeningResult({
  instanceId,
  caregiverId,
  caregiverName,
  requirementName,
}: {
  readonly instanceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly requirementName: string
}): ReactNode {
  const [state, formAction] = useActionState(recordHealthScreeningResultAction, {})
  const [open, setOpen] = useState(false)
  const title = `Record ${requirementName} result`

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`${title} for ${caregiverName ?? 'this caregiver'}`}
        onClick={() => setOpen(true)}
      >
        Record result
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="instanceId" value={instanceId} />
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <SelectField name="outcome" label="Result" options={OUTCOMES} placeholder="Choose a result" defaultValue="" required />
          <DateField name="resultedOn" label="Result date" required />
          <p className="text-sm text-ink">
            Record the result and date as written on the clinic&apos;s report. Passed satisfies the requirement;
            Failed returns it for a new result. This is recorded under your name with the time.
          </p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Recording…">Record result</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
