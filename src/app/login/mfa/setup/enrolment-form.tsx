'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { confirmMfaEnrolment } from '../../actions'

function inFours(value: string): string {
  return value.match(/.{1,4}/g)?.join('-') ?? value
}

const CONTINUE_LINK = (
  <Link
    href="/"
    className="inline-flex min-h-touch items-center text-sm font-medium text-brand-700"
  >
    Continue to Credora
  </Link>
)

export function EnrolmentForm({
  enrolment,
}: {
  readonly enrolment: { readonly secret: string; readonly otpauthUri: string } | null
}) {
  const [state, formAction] = useActionState(confirmMfaEnrolment, {})

  if (state.recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" live>
          Two-step sign-in is on.
        </Alert>
        <h2 className="text-lg font-semibold text-ink">Save your recovery codes</h2>
        <p className="text-sm text-ink-muted">
          Each code works once. Use one if you lose your phone. Keep them somewhere safe — they will
          not be shown again.
        </p>
        <ol className="flex flex-col gap-1 font-mono text-ink">
          {state.recoveryCodes.map((code) => (
            <li key={code}>{inFours(code)}</li>
          ))}
        </ol>
        {CONTINUE_LINK}
      </div>
    )
  }

  if (enrolment === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-ink">Two-step sign-in is already set up.</p>
        {CONTINUE_LINK}
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink">
          Add Credora to an authenticator app (for example Google Authenticator, Microsoft
          Authenticator or 1Password) with this key:
        </p>
        <code className="select-all break-all rounded-control border border-border-strong bg-surface p-3 font-mono text-ink">
          {inFours(enrolment.secret)}
        </code>
        <a
          href={enrolment.otpauthUri}
          className="inline-flex min-h-touch items-center text-sm font-medium text-brand-700"
        >
          Open in an authenticator app on this device
        </a>
      </div>
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <TextField
        name="code"
        label="6-digit code from the app"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      <SubmitButton pendingLabel="Checking…">Turn on two-step sign-in</SubmitButton>
    </form>
  )
}
