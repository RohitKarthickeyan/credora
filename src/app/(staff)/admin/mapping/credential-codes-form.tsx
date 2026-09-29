'use client'

import { useActionState } from 'react'
import { type AlayaCareMapping, CREDENTIAL_TYPES } from '@/domain/sync/alayacare-mapping'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { MappingFormState } from './actions'

export function CredentialCodesForm({
  action,
  credentialCodes,
}: {
  action: (previous: MappingFormState, formData: FormData) => Promise<MappingFormState>
  credentialCodes: AlayaCareMapping['credentialCodes']
}) {
  const [state, formAction] = useActionState(action, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">Credential codes</h2>
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-start gap-4">
        {CREDENTIAL_TYPES.map((type) => {
          const name = `code.${type}`
          return (
            <TextField
              key={type}
              name={name}
              label={type}
              hint="Blank: not synced"
              maxLength={100}
              defaultValue={state.values?.[name] ?? credentialCodes[type] ?? ''}
              error={state.fieldErrors?.[name]}
              containerClassName="w-48"
            />
          )
        })}
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">Save credential codes</SubmitButton>
      </div>
    </form>
  )
}
