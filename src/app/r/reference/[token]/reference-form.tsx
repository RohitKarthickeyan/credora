'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { submitReferenceAction } from './actions'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

export function ReferenceForm({ token, agencyName }: { readonly token: string; readonly agencyName: string }) {
  const [state, formAction] = useActionState(submitReferenceAction.bind(null, token), {})

  if (state.done) {
    return (
      <Alert tone="success" live>
        {`Thank you. Your answers were sent to ${agencyName}.`}
      </Alert>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
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
      <TextField name="comments" label="Comments (optional)" maxLength={500} hint="Up to 500 characters." />
      <SubmitButton pendingLabel="Sending…" className="w-full">
        Send answers
      </SubmitButton>
    </form>
  )
}
