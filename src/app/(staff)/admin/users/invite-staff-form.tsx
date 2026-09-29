'use client'

import { useActionState } from 'react'
import { STAFF_ROLE_LABELS } from '@/app/_lib/staff-role'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { inviteStaffUserAction } from './actions'

export const ROLE_OPTIONS = Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function InviteStaffForm() {
  const [state, formAction] = useActionState(inviteStaffUserAction, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      {state.invited ? (
        <Alert tone="success" live>
          Invite sent to {state.invited}.
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-start gap-4">
        <TextField
          name="fullName"
          label="Full name"
          required
          maxLength={200}
          defaultValue={state.values?.fullName}
          error={state.fieldErrors?.fullName}
          containerClassName="min-w-56 flex-1"
        />
        <TextField
          name="email"
          type="email"
          label="Work email"
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
          containerClassName="min-w-64 flex-1"
        />
        <SelectField
          name="role"
          label="Role"
          required
          options={ROLE_OPTIONS}
          placeholder="Choose a role"
          defaultValue={state.values?.role ?? ''}
          error={state.fieldErrors?.role}
          containerClassName="w-60"
        />
      </div>
      <div>
        <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
      </div>
    </form>
  )
}
