'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import type { ReferenceCheckDecision } from '@/domain/requirements/reference-check'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { decideReferenceCheckAction } from './reference-actions'

const COPY: Record<
  ReferenceCheckDecision,
  {
    readonly button: string
    readonly variant: 'secondary' | 'danger'
    readonly ariaLabel: (label: string) => string
    readonly title: string
    readonly statement: (label: string) => string
    readonly pending: string
  }
> = {
  SATISFIED_AFTER_REVIEW: {
    button: 'Satisfy',
    variant: 'secondary',
    ariaLabel: (label) => `Satisfy reference check for ${label} after review`,
    title: 'Satisfy reference check after review',
    statement: (label) =>
      `A reference did not confirm or recommend ${label}. Satisfy the reference check only after reading every answer and making any calls you need. It is satisfied under your name.`,
    pending: 'Satisfying…',
  },
  FAILED_AFTER_REVIEW: {
    button: 'Fail',
    variant: 'danger',
    ariaLabel: (label) => `Fail reference check for ${label} after review`,
    title: 'Fail reference check after review',
    statement: (label) =>
      `A reference did not confirm or recommend ${label}. Failing the reference check blocks clearance until the caregiver is withdrawn.`,
    pending: 'Failing…',
  },
}

export function DecideReferenceCheck({
  caregiverId,
  caregiverName,
  decision,
}: {
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly decision: ReferenceCheckDecision
}): ReactNode {
  const [state, formAction] = useActionState(decideReferenceCheckAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'
  const copy = COPY[decision]

  return (
    <>
      <Button variant={copy.variant} size="sm" aria-label={copy.ariaLabel(label)} onClick={() => setOpen(true)}>
        {copy.button}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={copy.title}>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <input type="hidden" name="decision" value={decision} />
          <p className="text-sm text-ink">{copy.statement(label)}</p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel={copy.pending}>{copy.button}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
