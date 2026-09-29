import { Controller, useFormContext } from 'react-hook-form'
import { YES_NO_VALUES, type FormField } from '@/domain/forms/definition'
import { US_STATE_CODES } from '@/domain/validation/address'
import { CheckboxField } from '@/ui/checkbox-field'
import { DateField } from '@/ui/date-field'
import { SelectField } from '@/ui/select-field'
import { TextField } from '@/ui/text-field'

const YES_NO_OPTIONS = YES_NO_VALUES.map((value) => ({
  value,
  label: value === 'yes' ? 'Yes' : 'No',
}))
const STATE_OPTIONS = US_STATE_CODES.map((code) => ({ value: code, label: code }))
const CHOOSE_ONE = 'Choose one'

export function FormFieldInput({ field, path }: { field: FormField; path: string }) {
  const { register, control, getFieldState, formState } = useFormContext()
  const errorAt = (at: string) => getFieldState(at, formState).error?.message
  const common = { label: field.label, hint: field.hint, error: errorAt(path), ...register(path) }

  switch (field.kind) {
    case 'text':
      return <TextField {...common} maxLength={field.maxLength} />
    case 'email':
      return <TextField {...common} type="email" inputMode="email" autoComplete="email" />
    case 'phone':
      return <TextField {...common} type="tel" inputMode="tel" autoComplete="tel" />
    case 'ssn':
      return <TextField {...common} type="text" inputMode="numeric" autoComplete="off" />
    case 'integer':
      // Not type="number": it silently swallows non-numeric input and the scroll wheel changes it.
      return <TextField {...common} type="text" inputMode="numeric" />
    case 'personName':
    case 'nameList':
    case 'documentNumber':
      return <TextField {...common} type="text" autoComplete="off" />
    case 'money':
      return <TextField {...common} type="text" inputMode="decimal" />
    case 'routingNumber':
    case 'accountNumber':
      return <TextField {...common} type="text" inputMode="numeric" autoComplete="off" />
    case 'dateOfBirth':
      return <DateField {...common} autoComplete="bday" />
    case 'date':
      return <DateField {...common} />
    case 'select':
      return <SelectField {...common} options={field.options} placeholder={CHOOSE_ONE} />
    case 'yesNo':
      return <SelectField {...common} options={YES_NO_OPTIONS} placeholder={CHOOSE_ONE} />
    case 'multiSelect':
      return (
        <Controller
          name={path}
          control={control}
          render={({ field: { value, onChange, onBlur } }) => {
            const selected: readonly string[] = value
            return (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium text-ink">{field.label}</legend>
                {field.hint ? <p className="text-sm text-ink-muted">{field.hint}</p> : null}
                {field.options.map((option) => (
                  <CheckboxField
                    key={option.value}
                    name={`${path}-${option.value}`}
                    label={option.label}
                    checked={selected.includes(option.value)}
                    onBlur={onBlur}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, option.value]
                          : selected.filter((chosen) => chosen !== option.value),
                      )
                    }
                  />
                ))}
                {errorAt(path) ? (
                  <p id={`${path}-error`} role="alert" className="text-sm text-status-danger-fg">
                    {errorAt(path)}
                  </p>
                ) : null}
              </fieldset>
            )
          }}
        />
      )
    case 'address':
      return (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-medium text-ink">{field.label}</legend>
          {field.hint ? <p className="text-sm text-ink-muted">{field.hint}</p> : null}
          <TextField
            label="Street address"
            autoComplete="address-line1"
            error={errorAt(`${path}.line1`)}
            {...register(`${path}.line1`)}
          />
          <TextField
            label="Apartment, suite or unit (optional)"
            autoComplete="address-line2"
            error={errorAt(`${path}.line2`)}
            {...register(`${path}.line2`)}
          />
          <TextField
            label="City"
            autoComplete="address-level2"
            error={errorAt(`${path}.city`)}
            {...register(`${path}.city`)}
          />
          <SelectField
            label="State"
            autoComplete="address-level1"
            options={STATE_OPTIONS}
            placeholder={CHOOSE_ONE}
            error={errorAt(`${path}.state`)}
            {...register(`${path}.state`)}
          />
          <TextField
            label="ZIP code"
            autoComplete="postal-code"
            inputMode="numeric"
            error={errorAt(`${path}.zip`)}
            {...register(`${path}.zip`)}
          />
        </fieldset>
      )
  }
}
