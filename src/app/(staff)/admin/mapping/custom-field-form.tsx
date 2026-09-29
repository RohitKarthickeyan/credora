'use client'

import { useActionState } from 'react'
import { ALAYACARE_CUSTOM_FIELD_TYPES } from '@/domain/sync/alayacare-mapping'
import { Alert } from '@/ui/alert'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { MappingFormState } from './actions'
import { SOURCE_OPTIONS } from './source-options'

const TYPE_OPTIONS = ALAYACARE_CUSTOM_FIELD_TYPES.map((type) => ({ value: type, label: type }))

export function CustomFieldForm({
  action,
}: {
  action: (previous: MappingFormState, formData: FormData) => Promise<MappingFormState>
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
          name="alayaCareKey"
          label="AlayaCare field key"
          required
          maxLength={100}
          defaultValue={state.values?.alayaCareKey}
          error={state.fieldErrors?.alayaCareKey}
          containerClassName="w-64"
        />
        <SelectField
          name="alayaCareType"
          label="Type in AlayaCare"
          required
          options={TYPE_OPTIONS}
          placeholder="Choose a type"
          defaultValue={state.values?.alayaCareType ?? ''}
          error={state.fieldErrors?.alayaCareType}
          containerClassName="w-44"
        />
        <SelectField
          name="source"
          label="Filled from"
          required
          options={SOURCE_OPTIONS}
          placeholder="Choose a source"
          defaultValue={state.values?.source ?? ''}
          error={state.fieldErrors?.source}
          containerClassName="min-w-72 flex-1"
        />
      </div>
      <div>
        <SubmitButton pendingLabel="Adding…">Add custom field</SubmitButton>
      </div>
    </form>
  )
}
