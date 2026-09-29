'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import type { ProfileChoices, ResolvableProfileField } from '@/domain/sync/alayacare-conflict'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { retrySyncAction } from './actions'

const OPTIONS = [
  { value: 'OURS', label: "Keep Credora's value (overwrite AlayaCare)" },
  { value: 'THEIRS', label: "Keep AlayaCare's value" },
]

export function RetrySync({
  caregiverId,
  fields,
  dateOfBirthConflict,
  choices,
}: {
  readonly caregiverId: string
  readonly fields: ReadonlyArray<{ readonly field: ResolvableProfileField; readonly label: string }>
  readonly dateOfBirthConflict: boolean
  readonly choices: ProfileChoices
}): ReactNode {
  const [state, formAction] = useActionState(retrySyncAction, {})

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <input type="hidden" name="caregiverId" value={caregiverId} />
      {dateOfBirthConflict ? (
        <p>
          AlayaCare never changes a recorded date of birth. Correct whichever record is wrong, then retry.
        </p>
      ) : null}
      {fields.map(({ field, label }) => (
        <SelectField
          key={field}
          name={`choice.${field}`}
          label={label}
          options={OPTIONS}
          placeholder="Choose which value AlayaCare keeps"
          defaultValue={choices[field] ?? ''}
          required
        />
      ))}
      <div>
        <SubmitButton pendingLabel="Queueing…">Retry sync</SubmitButton>
      </div>
    </form>
  )
}
