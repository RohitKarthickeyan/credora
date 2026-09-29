'use client'

import { useActionState } from 'react'
import { PAYERS, SERVICE_TYPES, STATES } from '@/domain/requirements/vocabulary'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { InviteFormState } from './actions'
import { inviteCaregiverAction } from './actions'

const STATE_LABELS: Record<(typeof STATES)[number], string> = { NY: 'New York' }
const SERVICE_TYPE_LABELS: Record<(typeof SERVICE_TYPES)[number], string> = {
  HHA: 'Home health aide (HHA)',
  PCA: 'Personal care aide (PCA)',
}
const PAYER_LABELS: Record<(typeof PAYERS)[number], string> = { PRIVATE_PAY: 'Private pay' }

const STATE_OPTIONS = STATES.map((value) => ({ value, label: STATE_LABELS[value] }))
const SERVICE_TYPE_OPTIONS = SERVICE_TYPES.map((value) => ({
  value,
  label: SERVICE_TYPE_LABELS[value],
}))
const PAYER_OPTIONS = PAYERS.map((value) => ({ value, label: PAYER_LABELS[value] }))

export function InviteForm() {
  const [state, formAction] = useActionState<InviteFormState, FormData>(inviteCaregiverAction, {})
  const errors = state.fieldErrors

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="legalFirstName"
          label="Legal first name"
          required
          maxLength={100}
          defaultValue={state.values?.legalFirstName}
          error={errors?.legalFirstName}
        />
        <TextField
          name="legalLastName"
          label="Legal last name"
          required
          maxLength={100}
          defaultValue={state.values?.legalLastName}
          error={errors?.legalLastName}
        />
      </div>
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="off"
        required
        defaultValue={state.values?.email}
        error={errors?.email}
        containerClassName="sm:w-1/2"
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          name="workState"
          label="State"
          required
          options={STATE_OPTIONS}
          defaultValue={state.values?.workState ?? STATES[0]}
          error={errors?.workState}
        />
        <SelectField
          name="serviceType"
          label="Service type"
          required
          options={SERVICE_TYPE_OPTIONS}
          placeholder="Choose HHA or PCA"
          defaultValue={state.values?.serviceType ?? ''}
          error={errors?.serviceType}
        />
        <SelectField
          name="payer"
          label="Payer"
          required
          options={PAYER_OPTIONS}
          defaultValue={state.values?.payer ?? PAYERS[0]}
          error={errors?.payer}
        />
      </div>
      <div>
        <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
      </div>
    </form>
  )
}
