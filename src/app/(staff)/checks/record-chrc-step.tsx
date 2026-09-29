'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChrcStep } from '@/domain/requirements/chrc'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { recordChrcStepAction } from './actions'

const COPY: Record<
  ChrcStep,
  {
    readonly button: string
    readonly ariaLabel: (label: string) => string
    readonly title: string
    readonly statement: (label: string) => string
  }
> = {
  SUBMISSION: {
    button: 'Record submission',
    ariaLabel: (label) => `Record CHRC submission for ${label}`,
    title: 'Record CHRC submission',
    statement: (label) =>
      `You are recording that ${label}'s criminal history record check was submitted to the NY DOH. It is recorded under your name with today's date, and then waits for DOH's result.`,
  },
  RESULT: {
    button: 'Record result',
    ariaLabel: (label) => `Record CHRC result for ${label}`,
    title: 'Record CHRC result',
    statement: (label) =>
      `You are recording that the NY DOH returned a favourable determination for ${label}. This satisfies the criminal history record check and is recorded under your name with the time. If DOH returned anything else, do not record it here.`,
  },
}

export function RecordChrcStep({
  instanceId,
  caregiverName,
  step,
}: {
  readonly instanceId: string
  readonly caregiverName: string | null
  readonly step: ChrcStep
}): ReactNode {
  const [state, formAction] = useActionState(recordChrcStepAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'
  const copy = COPY[step]

  return (
    <>
      <Button variant="secondary" size="sm" aria-label={copy.ariaLabel(label)} onClick={() => setOpen(true)}>
        {copy.button}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={copy.title}>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="instanceId" value={instanceId} />
          <input type="hidden" name="step" value={step} />
          <p className="text-sm text-ink">{copy.statement(label)}</p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Recording…">{copy.button}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
