import { z } from 'zod'
import type { PersonName } from '@/domain/validation/name'

type NormalisedField<T> = {
  readonly asPrinted: string
  // null: printed, but not in any form this module reads.
  readonly value: T | null
  readonly confidence: number
}

type FieldValues = {
  fullName: PersonName
  dateOfBirth: string
  address: string
  documentNumber: string
  issuer: string
  issueDate: string
  expiryDate: string
  completionDate: string
  trainingMinutes: number
}

export type NormalisedFields = {
  readonly [K in keyof FieldValues]?: NormalisedField<FieldValues[K]>
}

export type DocumentExtraction = {
  readonly uploadedDocumentId: string
  readonly caregiverId: string
  readonly instanceId: string
  readonly evidenceKey: string
  // 0 means the document was not recognised.
  readonly confidence: number
  readonly fields: NormalisedFields
}

type Reading = {
  readonly name: keyof NormalisedFields
  readonly asPrinted: string
  readonly confidence: number
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const NUMERIC_DATE = /^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})$/
const NAMED_MONTH_DATE = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/i
const HOURS = /^(\d+)(?:\.(\d{1,2}))? ?(?:hours|hour|hrs|hr)$/i
const MINUTES = /^(\d+) ?(?:minutes|minute|mins|min)$/i

function isoDate(year: string, month: string, day: string): string | null {
  const built = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return z.iso.date().safeParse(built).success ? built : null
}

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase()
  const index = MONTHS.findIndex((month) => month === lower || month.slice(0, 3) === lower)
  return index === -1 ? null : index + 1
}

// Numeric dates are read month first (OPEN-QUESTIONS 135). A two-digit year is 20YY except on a date of
// birth, where it is ambiguous by a century and so unreadable (OPEN-QUESTIONS 134).
export function parseDocumentDate(text: string, twoDigitYearAllowed: boolean): string | null {
  if (ISO_DATE.test(text)) return z.iso.date().safeParse(text).success ? text : null

  const numeric = NUMERIC_DATE.exec(text)
  if (numeric !== null) {
    const [, month = '', , day = '', year = ''] = numeric
    if (year.length === 2) return twoDigitYearAllowed ? isoDate(`20${year}`, month, day) : null
    return isoDate(year, month, day)
  }

  const named = NAMED_MONTH_DATE.exec(text)
  if (named !== null) {
    const [, monthName = '', day = '', year = ''] = named
    const month = monthNumber(monthName)
    return month === null ? null : isoDate(year, String(month), day)
  }

  return null
}

// Split, not understood: case and punctuation are kept, and suffixes and particles are not
// detected (T-072 folds the name for matching).
function personName(text: string): PersonName | null {
  const parts = text.split(',')
  if (parts.length > 2) return null

  if (parts.length === 2) {
    const [before = '', after = ''] = parts.map((part) => part.trim())
    if (before === '' || after === '') return null
    const [first = '', ...middle] = after.split(' ')
    return withMiddle({ first, last: before }, middle)
  }

  const tokens = text.split(' ')
  if (tokens.length < 2) return null
  const first = tokens[0] ?? ''
  const last = tokens[tokens.length - 1] ?? ''
  return withMiddle({ first, last }, tokens.slice(1, -1))
}

function withMiddle(name: { first: string; last: string }, middle: readonly string[]): PersonName {
  return middle.length === 0 ? name : { ...name, middle: middle.join(' ') }
}

function documentNumber(text: string): string | null {
  const stripped = text.toUpperCase().replace(/[\s-]/g, '')
  return stripped === '' ? null : stripped
}

function trainingMinutes(text: string): number | null {
  const minutes = MINUTES.exec(text)
  if (minutes !== null) return Number(minutes[1])

  const hours = HOURS.exec(text)
  if (hours === null) return null
  const hundredths = Number((hours[2] ?? '').padEnd(2, '0'))
  if ((hundredths * 60) % 100 !== 0) return null
  return Number(hours[1]) * 60 + (hundredths * 60) / 100
}

const RULES: { [K in keyof FieldValues]: (text: string) => FieldValues[K] | null } = {
  fullName: personName,
  dateOfBirth: (text) => parseDocumentDate(text, false),
  address: (text) => text,
  documentNumber,
  issuer: (text) => text,
  issueDate: (text) => parseDocumentDate(text, true),
  expiryDate: (text) => parseDocumentDate(text, true),
  completionDate: (text) => parseDocumentDate(text, true),
  trainingMinutes,
}

function put<K extends keyof FieldValues>(
  fields: { [P in K]?: NormalisedField<FieldValues[P]> },
  name: K,
  reading: Reading,
): void {
  const text = reading.asPrinted.trim().replace(/\s+/g, ' ')
  fields[name] = {
    asPrinted: reading.asPrinted,
    value: text === '' ? null : RULES[name](text),
    confidence: reading.confidence,
  }
}

/**
 * Confidences are carried, never rescaled: a penalty here would be a threshold, and thresholds
 * are T-074's. Of two readings of one name the more confident wins; on a tie, the first.
 */
export function normaliseFields(read: readonly Reading[]): NormalisedFields {
  const best = new Map<keyof FieldValues, Reading>()
  for (const reading of read) {
    const kept = best.get(reading.name)
    if (kept === undefined || reading.confidence > kept.confidence) best.set(reading.name, reading)
  }

  const fields: NormalisedFields = {}
  for (const [name, reading] of best) put(fields, name, reading)
  return fields
}
