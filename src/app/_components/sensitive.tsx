'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SensitiveFieldDisplay, SensitiveFieldReveal } from '@/domain/masking/sensitive-field'
import { maskSensitiveField } from '@/domain/masking/sensitive-field'
import { formatSsn } from '@/domain/validation/ssn'
import { Button } from '@/ui/button'
import { Dialog } from '@/ui/dialog'
import { MaskedValue } from '@/ui/masked-value'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'

export type RevealSensitiveFieldState =
  | { readonly status: 'idle' }
  | { readonly status: 'invalid'; readonly message: string }
  | SensitiveFieldReveal

type RevealSensitiveFieldAction = (
  previous: RevealSensitiveFieldState,
  formData: FormData,
) => Promise<RevealSensitiveFieldState>

const IDLE: RevealSensitiveFieldState = { status: 'idle' }

/**
 * Masked by default (SECURITY.md § Field masking). The plaintext is never a prop: the only way
 * it reaches this component is the reveal action's return value, and it lives in React state
 * until unmount — never in the URL, storage or a log.
 */
export function Sensitive(
  props: SensitiveFieldDisplay & {
    readonly caregiverId: string
    readonly label: string
    readonly reveal: RevealSensitiveFieldAction
  },
): ReactNode {
  const { caregiverId, field, label, reveal } = props
  const [state, formAction] = useActionState(reveal, IDLE)
  const [requested, setRequested] = useState(false)
  const valueRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const settled = state.status === 'revealed' || state.status === 'absent'

  useEffect(() => {
    if (settled) valueRef.current?.focus()
  }, [settled])

  // React's autoFocus never reaches the DOM attribute, so showModal() would focus the dialog's
  // first control, Close. This parent effect runs after Dialog's showModal() effect.
  useEffect(() => {
    const reason = formRef.current?.elements.namedItem('reason')
    if (requested && reason instanceof HTMLInputElement) reason.focus()
  }, [requested])

  const masked = maskSensitiveField(props)

  if (masked === null) return <MaskedValue label={label} masked="Not provided" />

  if (settled) {
    const shown =
      state.status === 'absent' ? 'Not provided' : field === 'ssn' ? formatSsn(state.value) : state.value
    return (
      <div ref={valueRef} tabIndex={-1}>
        <MaskedValue label={label} masked={shown} />
      </div>
    )
  }

  return (
    <>
      <MaskedValue
        label={label}
        masked={masked}
        action={
          <Button
            variant="secondary"
            size="md"
            aria-label={`Reveal ${label}`}
            onClick={() => setRequested(true)}
          >
            Reveal
          </Button>
        }
      />
      <Dialog
        open={requested}
        onClose={() => setRequested(false)}
        title={`Reason for viewing ${label}`}
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <input type="hidden" name="field" value={field} />
          <TextField
            name="reason"
            label="Reason"
            required
            maxLength={500}
            hint="Recorded in the audit log with your name and the time. Do not type the value itself."
            error={state.status === 'invalid' ? state.message : undefined}
          />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Revealing…">Reveal</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  )
}
