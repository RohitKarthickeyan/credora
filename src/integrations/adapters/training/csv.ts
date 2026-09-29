import { z } from 'zod'
import { trainingRecordSchema } from '@/integrations/ports/training'
import type { TrainingImport, TrainingRecord } from '@/integrations/ports/training'

const COLUMNS = ['external_caregiver_id', 'course_code', 'course_name', 'completed_on', 'minutes'] as const
const HEADER = COLUMNS.join(',')
const isoDate = z.iso.date()

function splitLine(line: string): { fields: string[] } | { error: string } {
  const fields: string[] = []
  let textAfterQuote = false
  let i = 0
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i++
    if (line[i] === '"') {
      let value = ''
      let j = i + 1
      for (;;) {
        const close = line.indexOf('"', j)
        if (close === -1) return { error: 'unterminated quoted field' }
        value += line.slice(j, close)
        if (line[close + 1] === '"') {
          value += '"'
          j = close + 2
        } else {
          i = close + 1
          break
        }
      }
      const comma = line.indexOf(',', i)
      const rest = comma === -1 ? line.slice(i) : line.slice(i, comma)
      if (rest.trim() !== '') textAfterQuote = true
      fields.push(value)
      if (comma === -1) break
      i = comma + 1
    } else {
      const comma = line.indexOf(',', i)
      fields.push((comma === -1 ? line.slice(i) : line.slice(i, comma)).trim())
      if (comma === -1) break
      i = comma + 1
    }
  }
  return textAfterQuote ? { error: 'unexpected text after a quoted field' } : { fields }
}

function toRecord(fields: string[]): { record: TrainingRecord } | { error: string } {
  if (fields.length !== COLUMNS.length) return { error: `expected ${COLUMNS.length} fields, found ${fields.length}` }
  const [externalCaregiverId = '', courseCode = '', courseName = '', completedOn = '', minutes = ''] = fields
  for (const [column, value] of [
    ['external_caregiver_id', externalCaregiverId],
    ['course_code', courseCode],
    ['course_name', courseName],
  ] as const) {
    if (value === '') return { error: `${column} is empty` }
  }
  if (!isoDate.safeParse(completedOn).success) {
    return { error: `completed_on must be a calendar date as YYYY-MM-DD, got "${completedOn}"` }
  }
  if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes))) {
    return { error: `minutes must be a whole number, got "${minutes}"` }
  }
  return {
    record: trainingRecordSchema.parse({ externalCaregiverId, courseCode, courseName, completedOn, minutes: Number(minutes) }),
  }
}

export function parseTrainingCsv(text: string): Pick<TrainingImport, 'records' | 'rejected'> {
  const [headerLine = '', ...dataLines] = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (headerLine.split(',').map((field) => field.trim()).join(',') !== HEADER) {
    return { records: [], rejected: [{ line: 1, reason: `header must be exactly "${HEADER}"` }] }
  }

  const records: TrainingRecord[] = []
  const rejected: TrainingImport['rejected'] = []
  for (const [index, line] of dataLines.entries()) {
    if (line.trim() === '') continue
    const split = splitLine(line)
    const result = 'error' in split ? split : toRecord(split.fields)
    if ('error' in result) rejected.push({ line: index + 2, reason: result.error })
    else records.push(result.record)
  }
  return { records, rejected }
}
