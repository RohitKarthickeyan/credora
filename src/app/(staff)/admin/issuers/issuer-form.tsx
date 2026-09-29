'use client'

import { useActionState } from 'react'
import { ACCEPTED_ISSUER_KIND_LABELS } from '@/app/_lib/accepted-issuer-kind'
import type { AcceptedIssuerInput } from '@/domain/documents/accepted-issuer'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { IssuerFormState } from './actions'

const KIND_OPTIONS = Object.entries(ACCEPTED_ISSUER_KIND_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function IssuerForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (previous: IssuerFormState, formData: FormData) => Promise<IssuerFormState>
  defaults?: AcceptedIssuerInput
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-start gap-4">
        <TextField
          name="name"
          label="Name as printed on documents"
          required
          maxLength={200}
          defaultValue={state.values?.name ?? defaults?.name}
          error={state.fieldErrors?.name}
          containerClassName="min-w-72 flex-1"
        />
        <SelectField
          name="kind"
          label="Kind"
          required
          options={KIND_OPTIONS}
          placeholder="Choose a kind"
          defaultValue={state.values?.kind ?? defaults?.kind ?? ''}
          error={state.fieldErrors?.kind}
          containerClassName="w-56"
        />
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}
