'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { recordReferenceResponseAction } from './reference-actions'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

export function RecordReferenceResponse({
  referenceId,
  referenceName,
}: {
  readonly referenceId: string
  readonly referenceName: string
}): ReactNode {
  const [state, formAction] = useActionState(recordReferenceResponseAction, {})
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Record answers from ${referenceName}`}
        onClick={() => setOpen(true)}
      >
        Record answers
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record reference answers">
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="referenceId" value={referenceId} />
          <p className="text-sm text-ink">
            {`Record what ${referenceName} told you by phone. It is recorded under your name.`}
          </p>
          <SelectField
            name="workedWith"
            label="Did you work with or supervise them?"
            options={YES_NO}
            placeholder="Choose one"
            defaultValue=""
            required
          />
          <SelectField
            name="wouldRecommend"
            label="Would you recommend them for home care work?"
            options={YES_NO}
            placeholder="Choose one"
            defaultValue=""
            required
          />
          <TextField name="comments" label="Comments (optional)" maxLength={500} />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Record answers</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
