import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { type RawAnswers, blankAnswers } from '@/domain/forms/answers'
import type { FormGroup } from '@/domain/forms/definition'
import { visibleItems } from '@/domain/forms/visibility'
import { Button } from '@/ui/button'
import { Card } from '@/ui/card'
import { FormFieldInput } from './form-field'

export function RepeatingGroup({ group }: { group: FormGroup }) {
  const { control, getFieldState, formState } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name: group.id })
  const entries: readonly RawAnswers[] = useWatch({ control, name: group.id })
  // toNestErrors puts a field array's own error under `<group>.root` once any entry is
  // registered, and directly at `<group>` when there is none.
  const message =
    getFieldState(`${group.id}.root`, formState).error?.message ??
    getFieldState(group.id, formState).error?.message
  const title = group.itemLabel.charAt(0).toUpperCase() + group.itemLabel.slice(1)

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-base font-semibold text-ink">{group.label}</legend>
      {message ? (
        <p id={`${group.id}-error`} role="alert" className="text-sm text-status-danger-fg">
          {message}
        </p>
      ) : null}
      {fields.map((entry, index) => (
        <Card
          key={entry.id}
          title={`${title} ${index + 1}`}
          action={
            <Button variant="ghost" onClick={() => remove(index)}>
              Remove
            </Button>
          }
        >
          <div className="flex flex-col gap-6">
            {visibleItems(group.fields, entries[index] ?? {}).map((field) => (
              <FormFieldInput key={field.id} field={field} path={`${group.id}.${index}.${field.id}`} />
            ))}
          </div>
        </Card>
      ))}
      {group.max === undefined || fields.length < group.max ? (
        <Button variant="secondary" onClick={() => append(blankAnswers(group.fields))}>
          Add another {group.itemLabel}
        </Button>
      ) : null}
    </fieldset>
  )
}
