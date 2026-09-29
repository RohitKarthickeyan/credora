'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { QueueDecision } from '@/domain/documents/staff-decision'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { type DecideExceptionState, decideExceptionAction } from './actions'

const QUEUE_DECISION_COPY: Record<QueueDecision, string> = {
  ACCEPTED: 'Accept the document',
  REJECTED: 'Reject it and ask the caregiver for a different document',
  REUPLOAD_REQUESTED: 'Ask the caregiver for a clearer photo',
  WAIVED: 'Waive this requirement',
}

export function DecideException({
  instanceId,
  uploadedDocumentId,
  caregiverName,
  requirementName,
  decisions,
  trigger,
}: {
  readonly instanceId: string
  readonly uploadedDocumentId: string
  readonly caregiverName: string | null
  readonly requirementName: string
  readonly decisions: readonly QueueDecision[]
  readonly trigger: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(
    async (previous: DecideExceptionState, formData: FormData) => {
      const next = await decideExceptionAction(previous, formData)
      if (next.error === undefined) setOpen(false)
      return next
    },
    {},
  )
  const formRef = useRef<HTMLFormElement>(null)
  const name = caregiverName ?? 'this caregiver'
  const [only] = decisions

  // showModal() would otherwise focus Close; this parent effect runs after Dialog's.
  useEffect(() => {
    const decision = formRef.current?.elements.namedItem('decision')
    if (open && decision instanceof HTMLSelectElement) decision.focus()
  }, [open])

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`${trigger} ${requirementName} for ${name}`}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${requirementName}: ${name}`}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="instanceId" value={instanceId} />
          <input type="hidden" name="uploadedDocumentId" value={uploadedDocumentId} />
          {decisions.length === 1 && only !== undefined ? (
            <>
              <input type="hidden" name="decision" value={only} />
              <p className="text-sm text-ink">{QUEUE_DECISION_COPY[only]}.</p>
            </>
          ) : (
            <SelectField
              name="decision"
              label="Decision"
              required
              placeholder="Choose a decision"
              options={decisions.map((decision) => ({ value: decision, label: QUEUE_DECISION_COPY[decision] }))}
              hint="Rejecting or asking for a photo emails the caregiver. A waived requirement does not count toward clearance."
            />
          )}
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Recording…">Record decision</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
