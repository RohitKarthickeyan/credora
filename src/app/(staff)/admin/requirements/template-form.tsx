'use client'

import { useActionState, useState } from 'react'
import {
  EVIDENCE_KINDS,
  RENEWAL_RULES,
  REQUIREMENT_TYPES,
  VALIDITY_RULES,
} from '@/domain/requirements/template'
import {
  CAREGIVER_ROLES,
  DOCUMENT_KEYS,
  PAYERS,
  SERVICE_TYPES,
  STATES,
} from '@/domain/requirements/vocabulary'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { CheckboxField } from '@/ui/checkbox-field'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import type { TemplateFormState } from './actions'
import type { TemplateFormValues } from './template-form-data'

export type ScopePicker = 'state' | 'serviceType' | 'role' | 'payer'

const PICKERS: Record<ScopePicker, { label: string; values: readonly string[] }> = {
  state: { label: 'State', values: STATES },
  serviceType: { label: 'Service type', values: SERVICE_TYPES },
  role: { label: 'Role', values: CAREGIVER_ROLES },
  payer: { label: 'Payer', values: PAYERS },
}

function options(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }))
}

function evidenceRows(values: TemplateFormValues): number[] {
  const rows = Object.keys(values).flatMap((name) => {
    const index = /^evidence\.(\d+)\.kind$/.exec(name)?.[1]
    return index === undefined ? [] : [Number(index)]
  })
  return rows.length === 0 ? [0] : rows.sort((a, b) => a - b)
}

export function TemplateForm({
  action,
  defaults,
  submitLabel,
  showKey,
  scopePickers,
  fixedScope,
}: {
  action: (previous: TemplateFormState, formData: FormData) => Promise<TemplateFormState>
  defaults: TemplateFormValues
  submitLabel: string
  showKey: boolean
  scopePickers: readonly ScopePicker[]
  fixedScope?: string
}) {
  const [state, formAction] = useActionState(action, {})
  const values = state.values ?? defaults
  const errors = state.fieldErrors ?? {}
  const [type, setType] = useState(values.type ?? '')
  const [validityRule, setValidityRule] = useState(values.validityRule ?? '')
  const [manualOnly, setManualOnly] = useState(values.manualOnly === 'on')
  const [rows, setRows] = useState(() => evidenceRows(defaults))

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <Alert tone="info">
        Publishing creates a new version. Caregivers already given this requirement keep the
        version they were given.
      </Alert>

      {showKey ? (
        <TextField
          name="key"
          label="Key"
          hint="SCREAMING_SNAKE_CASE, e.g. AGENCY_ORIENTATION."
          required
          defaultValue={values.key}
          error={errors.key}
        />
      ) : null}
      {fixedScope ? <p className="text-sm text-ink">Applies to: {fixedScope}</p> : null}
      {scopePickers.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {scopePickers.map((axis) => (
            <SelectField
              key={axis}
              name={axis}
              label={PICKERS[axis].label}
              options={[{ value: '', label: 'Any / none' }, ...options(PICKERS[axis].values)]}
              defaultValue={values[axis] ?? ''}
              error={errors[axis]}
              containerClassName="w-48"
            />
          ))}
        </div>
      ) : null}

      <TextField name="name" label="Name" required defaultValue={values.name} error={errors.name} />
      <TextField
        name="description"
        label="Description"
        hint="Describe the requirement, never a caregiver: it is sent to document review."
        required
        defaultValue={values.description}
        error={errors.description}
      />
      <SelectField
        name="type"
        label="Type"
        required
        placeholder="Choose a type"
        options={options(REQUIREMENT_TYPES)}
        value={type}
        onChange={(event) => setType(event.target.value)}
        error={errors.type}
        containerClassName="w-56"
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-ink">Accepted evidence</legend>
        {rows.map((row) => (
          <div key={row} className="flex flex-wrap items-end gap-3">
            <SelectField
              name={`evidence.${row}.kind`}
              label="Kind"
              placeholder="Choose a kind"
              options={options(EVIDENCE_KINDS)}
              defaultValue={values[`evidence.${row}.kind`] ?? ''}
              size="sm"
              containerClassName="w-52"
            />
            <TextField
              name={`evidence.${row}.evidenceKey`}
              label="Evidence key"
              list="document-keys"
              defaultValue={values[`evidence.${row}.evidenceKey`]}
              size="sm"
              containerClassName="w-56"
            />
            <TextField
              name={`evidence.${row}.label`}
              label="Label"
              defaultValue={values[`evidence.${row}.label`]}
              size="sm"
              containerClassName="min-w-48 flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((other) => other !== row))}
            >
              Remove
            </Button>
          </div>
        ))}
        <datalist id="document-keys">
          {Object.values(DOCUMENT_KEYS).map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRows([...rows, Math.max(...rows) + 1])}
          >
            Add an evidence option
          </Button>
        </div>
        {errors.acceptedEvidence ? (
          <p role="alert" className="text-sm text-status-danger-fg">
            {errors.acceptedEvidence}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-start gap-4">
        <SelectField
          name="validityRule"
          label="Validity"
          required
          placeholder="Choose a rule"
          options={options(VALIDITY_RULES)}
          value={validityRule}
          onChange={(event) => setValidityRule(event.target.value)}
          error={errors.validityRule}
          containerClassName="w-56"
        />
        {validityRule === 'FIXED_PERIOD' ? (
          <TextField
            name="validityMonths"
            label="Valid for (months)"
            type="number"
            min={1}
            step={1}
            defaultValue={values.validityMonths}
            error={errors.validityMonths}
            containerClassName="w-40"
          />
        ) : null}
        <SelectField
          name="renewalRule"
          label="Renewal"
          required
          placeholder="Choose a rule"
          options={options(RENEWAL_RULES)}
          defaultValue={values.renewalRule ?? ''}
          error={errors.renewalRule}
          containerClassName="w-56"
        />
        {type === 'TRAINING' ? (
          <TextField
            name="minimumMinutes"
            label="Annual minimum (minutes)"
            type="number"
            min={1}
            step={1}
            defaultValue={values.minimumMinutes}
            error={errors.minimumMinutes}
            containerClassName="w-48"
          />
        ) : null}
      </div>

      <CheckboxField
        name="blocksClearance"
        label="Blocks clearance until satisfied"
        defaultChecked={values.blocksClearance === 'on'}
      />
      <CheckboxField
        name="manualOnly"
        label="Manual only: a person must perform this step"
        checked={manualOnly}
        onChange={(event) => setManualOnly(event.target.checked)}
      />
      {manualOnly ? (
        <TextField
          name="manualOnlyReason"
          label="Regulation that requires a person"
          required
          defaultValue={values.manualOnlyReason}
          error={errors.manualOnlyReason}
        />
      ) : null}

      <div>
        <SubmitButton pendingLabel="Publishing…">{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}
