import type { FormField, FormGroup, FormSection } from './definition'

type RawAddress = Readonly<Record<'line1' | 'line2' | 'city' | 'state' | 'zip', string>>
type RawValue = string | readonly string[] | RawAddress | readonly RawAnswers[]
export type RawAnswers = { readonly [id: string]: RawValue }

const BLANK_ADDRESS: RawAddress = { line1: '', line2: '', city: '', state: '', zip: '' }

function blankValue(item: FormField | FormGroup): RawValue {
  switch (item.kind) {
    case 'group':
      return Array.from({ length: item.min }, () => blankAnswers(item.fields))
    case 'multiSelect':
      return []
    case 'address':
      return BLANK_ADDRESS
    default:
      return ''
  }
}

export function blankAnswers(items: readonly (FormField | FormGroup)[]): RawAnswers {
  return Object.fromEntries(items.map((item) => [item.id, blankValue(item)]))
}

export function emptyAnswers(section: FormSection): RawAnswers {
  return blankAnswers(section.items)
}
