'use client'

import { useActionState } from 'react'
import type { StaffUser } from '@/domain/auth/staff-user'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import {
  changeStaffRoleAction,
  resendStaffInviteAction,
  resetStaffMfaAction,
  setStaffUserActiveAction,
} from './actions'
import { ROLE_OPTIONS } from './invite-staff-form'

export function StaffUserControls({ user }: { readonly user: StaffUser }) {
  const [roleState, roleAction] = useActionState(changeStaffRoleAction.bind(null, user.id), {})
  const [activeState, activeAction] = useActionState(
    setStaffUserActiveAction.bind(null, user.id, !user.isActive),
    {},
  )
  const [resendState, resendAction] = useActionState(resendStaffInviteAction.bind(null, user.id), {})
  const [resetState, resetAction] = useActionState(resetStaffMfaAction.bind(null, user.id), {})
  const error = roleState.error ?? activeState.error ?? resendState.error ?? resetState.error
  const selectId = `role-${user.id}`

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
      {resendState.notice ? (
        <Alert tone="success" live>
          {resendState.notice}
        </Alert>
      ) : null}
      {resetState.notice ? (
        <Alert tone="success" live>
          {resetState.notice}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* A plain select rather than SelectField: that one's id is its name, and every row's is "role". */}
        <form action={roleAction} className="flex flex-wrap items-center justify-end gap-2">
          <label htmlFor={selectId} className="sr-only">
            Role for {user.fullName}
          </label>
          <select
            id={selectId}
            name="role"
            defaultValue={user.role}
            className="min-h-9 rounded-control border border-border-strong bg-surface px-3 text-field text-ink"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
            Change role
          </SubmitButton>
        </form>
        <form action={activeAction}>
          <SubmitButton
            size="sm"
            variant="secondary"
            aria-label={`${user.isActive ? 'Deactivate' : 'Reactivate'} ${user.fullName}`}
          >
            {user.isActive ? 'Deactivate' : 'Reactivate'}
          </SubmitButton>
        </form>
        {user.isActive && user.invitePending ? (
          <form action={resendAction}>
            <SubmitButton
              size="sm"
              variant="secondary"
              pendingLabel="Queuing…"
              aria-label={`Resend invite to ${user.fullName}`}
            >
              Resend invite
            </SubmitButton>
          </form>
        ) : null}
        {user.invitePending ? null : (
          <form action={resetAction}>
            <SubmitButton
              size="sm"
              variant="secondary"
              pendingLabel="Resetting…"
              aria-label={`Reset two-step sign-in for ${user.fullName}`}
            >
              Reset two-step sign-in
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
