'use client'

import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import type { BackgroundCheckAdjudication } from '@/domain/requirements/background-check'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { SubmitButton } from '@/ui/submit-button'
import { adjudicateBackgroundCheckAction } from './actions'

const COPY: Record<
  BackgroundCheckAdjudication,
  {
    readonly button: string
    readonly variant: 'secondary' | 'danger'
    readonly ariaLabel: (label: string) => string
    readonly title: string
    readonly statement: (label: string) => string
    readonly pending: string
  }
> = {
  CLEARED_AFTER_REVIEW: {
    button: 'Clear',
    variant: 'secondary',
    ariaLabel: (label) => `Clear background check for ${label} after review`,
    title: 'Clear background check after review',
    statement: (label) =>
      `${label}'s background check came back CONSIDER. Clear it only after reviewing the report with the vendor. The requirement is satisfied under your name.`,
    pending: 'Clearing…',
  },
  FAILED_AFTER_REVIEW: {
    button: 'Fail',
    variant: 'danger',
    ariaLabel: (label) => `Fail background check for ${label} after review`,
    title: 'Fail background check after review',
    statement: (label) =>
      `${label}'s background check came back CONSIDER. Failing it blocks clearance until the caregiver is withdrawn. Send any adverse-action notices outside Credora.`,
    pending: 'Failing…',
  },
}

export function AdjudicateBackgroundCheck({
  instanceId,
  caregiverName,
  adjudication,
}: {
  readonly instanceId: string
  readonly caregiverName: string | null
  readonly adjudication: BackgroundCheckAdjudication
}): ReactNode {
  const [state, formAction] = useActionState(adjudicateBackgroundCheckAction, {})
  const [open, setOpen] = useState(false)
  const label = caregiverName ?? 'this caregiver'
  const copy = COPY[adjudication]

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
          <input type="hidden" name="instanceId" value={instanceId} />
          <input type="hidden" name="adjudication" value={adjudication} />
          <p className="text-sm text-ink">{copy.statement(label)}</p>
          <div className="flex justify-end">
            <SubmitButton pendingLabel={copy.pending}>{copy.button}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
