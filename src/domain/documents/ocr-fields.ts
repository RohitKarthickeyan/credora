import { normalizeName, type PersonName } from '@/domain/validation/name'
import { parseDocumentDate } from './extraction'

type OcrLine = { readonly text: string; readonly confidence: number }

export type FoundField = {
  readonly name: 'fullName' | 'dateOfBirth' | 'issueDate' | 'expiryDate' | 'completionDate'
  readonly value: string
  readonly confidence: number
}

type KnownIdentity = { readonly legalName: PersonName; readonly dateOfBirth: string | null }

const DATE = /\d{4}-\d{2}-\d{2}|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|[A-Za-z]+\.? \d{1,2},? \d{4}/g

const DATE_LABELS: readonly [FoundField['name'], RegExp][] = [
  ['dateOfBirth', /\b(dob|birth|born)/i],
  ['expiryDate', /\bexp/i],
  ['issueDate', /\b(iss|issued|date of test|read|administered)/i],
  ['completionDate', /\b(complet|awarded)/i],
]

function words(text: string): string[] {
  return normalizeName(text)
    .replace(/[^a-z ]/g, '')
    .split(' ')
    .filter((word) => word.length > 0)
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i += 1
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

// OCR misreads a letter now and then (I as l, O as 0), so one edit is forgiven on names long
// enough that one edit does not reach another common name.
function nameOnLine(lineWords: readonly string[], nameWords: readonly string[]): boolean {
  return nameWords.length > 0 && nameWords.every((name) =>
    lineWords.some((word) => (name.length <= 4 ? word === name : withinOneEdit(word, name))),
  )
}

// A date takes its label from the text between the previous date (or the line start) and itself,
// so "ISS 01/10/2025 EXP 03/14/2029" labels each date by its own prefix.
function datesOn(line: OcrLine, dateOfBirth: string | null): FoundField[] {
  let labelStart = 0
  return [...line.text.matchAll(DATE)].flatMap(({ 0: match, index }): FoundField[] => {
    const labelText = line.text.slice(labelStart, index)
    labelStart = index + match.length
    const value = parseDocumentDate(match, true)
    if (value === null) return []
    if (value === dateOfBirth) return [{ name: 'dateOfBirth', value, confidence: line.confidence }]
    const label = DATE_LABELS.find(([, pattern]) => pattern.test(labelText))
    return label === undefined ? [] : [{ name: label[0], value, confidence: line.confidence }]
  })
}

/**
 * Reads plain OCR lines for the fields review needs, looking for what intake already says rather
 * than parsing the layout: a line carrying the caregiver's first and last name, the intake date
 * of birth, and dates whose own line labels them. A found name is reported as the intake name, so
 * an OCR slip or the words around it do not fail identity matching.
 */
export function findKnownFields(lines: readonly OcrLine[], known: KnownIdentity): readonly FoundField[] {
  const { first: firstName, middle, last: lastName } = known.legalName
  const first = words(firstName)
  const last = words(lastName)
  const fullName = [firstName, middle, lastName].filter((part) => part !== undefined).join(' ')

  return lines.flatMap((line): FoundField[] => {
    const lineWords = words(line.text)
    const name: FoundField[] =
      nameOnLine(lineWords, first) && nameOnLine(lineWords, last)
        ? [{ name: 'fullName', value: fullName, confidence: line.confidence }]
        : []
    return [...name, ...datesOn(line, known.dateOfBirth)]
  })
}
