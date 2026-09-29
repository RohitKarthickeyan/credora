'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { linkTrainingAccountAction } from './actions'

export function LinkTrainingAccount({
  externalCaregiverId,
  caregivers,
}: {
  readonly externalCaregiverId: string
  readonly caregivers: ReadonlyArray<{ readonly value: string; readonly label: string }>
}): ReactNode {
  const [state, formAction] = useActionState(linkTrainingAccountAction, {})

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <input type="hidden" name="externalCaregiverId" value={externalCaregiverId} />
      <SelectField
        name="caregiverId"
        label={`Caregiver for ${externalCaregiverId}`}
        size="sm"
        options={caregivers}
        placeholder="Choose a caregiver"
        defaultValue=""
        required
      />
      <SubmitButton variant="secondary" pendingLabel="Linking…">
        Link and credit hours
      </SubmitButton>
    </form>
  )
}
