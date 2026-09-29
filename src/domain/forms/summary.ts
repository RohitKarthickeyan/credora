import type { RawAnswers } from './answers'
import { type LoadedSection, ROW_ID_KEY, type SealedOnFile } from './binding'
import type { FormField } from './definition'
import { visibleItems } from './visibility'

export type SummaryRow = { readonly label: string; readonly value: string }
type SummaryItem =
  | ({ readonly kind: 'field' } & SummaryRow)
  | { readonly kind: 'group'; readonly label: string; readonly entries: readonly (readonly SummaryRow[])[] }
export type SectionSummary = {
  readonly id: string
  readonly title: string
  readonly items: readonly SummaryItem[]
}

const NOT_GIVEN = 'Not given'

type RawValue = RawAnswers[string] | undefined
type RawAddress = Readonly<Record<'line1' | 'line2' | 'city' | 'state' | 'zip', string>>

function isBlank(value: RawValue): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return Object.values(value).every((part) => typeof part !== 'string' || part.trim() === '')
}

function sealedValue(onFile: SealedOnFile, id: string): string {
  const value = onFile[id]
  if (value === undefined) return NOT_GIVEN
  return value === true ? 'On file' : `Ending ${value}`
}

// A date is not an instant: formatted by splitting, never through Date, so no timezone shifts it.
function formatDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${month}/${day}/${year}`
}

function optionLabel(field: FormField, value: string): string {
  if (field.kind !== 'select' && field.kind !== 'multiSelect') return value
  return field.options.find((option) => option.value === value)?.label ?? value
}

function fieldValue(field: FormField, value: RawValue, onFile: SealedOnFile): string {
  switch (field.kind) {
    case 'ssn':
    case 'accountNumber':
    case 'routingNumber':
    case 'documentNumber':
      return sealedValue(onFile, field.id)
  }
  if (value === undefined || isBlank(value)) return NOT_GIVEN
  if (typeof value === 'string') {
    switch (field.kind) {
      case 'select':
        return optionLabel(field, value)
      case 'yesNo':
        return value === 'yes' ? 'Yes' : 'No'
      case 'date':
      case 'dateOfBirth':
        return formatDate(value)
      case 'money':
        return `$${value}`
      default:
        return value
    }
  }
  if (isList(value)) return value.map((item) => optionLabel(field, item)).join(', ')
  if (isAddress(value)) {
    const stateZip = [value.state, value.zip].filter(isPresent).join(' ')
    return [value.line1, value.line2, value.city, stateZip].filter(isPresent).join(', ')
  }
  return NOT_GIVEN
}

const isPresent = (part: string) => part.trim() !== ''

function isList(value: RawValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAddress(value: RawValue): value is RawAddress {
  return typeof value === 'object' && !Array.isArray(value) && 'line1' in value
}

function rows(fields: readonly FormField[], answers: RawAnswers, onFile: SealedOnFile): SummaryRow[] {
  return visibleItems(fields, answers).map((field) => ({
    label: field.label,
    value: fieldValue(field, answers[field.id], onFile),
  }))
}

function isEntries(value: RawValue): value is readonly RawAnswers[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null)
}

export function summariseSection(loaded: LoadedSection, onFile: SealedOnFile): SectionSummary {
  const { section, answers } = loaded
  const items = visibleItems(section.items, answers).map((item): SummaryItem => {
    if (item.kind !== 'group') {
      return { kind: 'field', label: item.label, value: fieldValue(item, answers[item.id], onFile) }
    }
    const value = answers[item.id]
    const entries = (isEntries(value) ? value : [])
      .filter(
        (entry) =>
          entry[ROW_ID_KEY] !== undefined ||
          visibleItems(item.fields, entry).some((field) => !isBlank(entry[field.id])),
      )
      .map((entry) => rows(item.fields, entry, {}))
    return { kind: 'group', label: item.label, entries }
  })
  return { id: section.id, title: section.title, items }
}
