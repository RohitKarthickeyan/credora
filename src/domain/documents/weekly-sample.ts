import type { AutoAcceptDecision } from './auto-accept'
import type { JudgeReasoning, QueueDocument } from './exception-queue'
import type { JudgeDecision } from './judge-review'

export type SampleWeek = {
  readonly key: string // ISO week-year and week, 'YYYY-Www'
  readonly start: Date // Monday 00:00 UTC, inclusive
  readonly end: Date // the following Monday 00:00 UTC, exclusive
}

export type SampledRecord = QueueDocument & {
  readonly acceptedAt: Date
  readonly identity: AutoAcceptDecision['identity']
  readonly judge: JudgeDecision
  readonly judgeReasoning: JudgeReasoning
}

export type WeeklySample = {
  readonly week: SampleWeek
  readonly autoAccepted: number
  readonly records: readonly SampledRecord[]
}

// OPEN-QUESTIONS 174.
const WEEKLY_SAMPLE_SIZE = 10

const DAY_MS = 24 * 60 * 60 * 1000

/** The last complete ISO week (Monday 00:00 UTC to Monday 00:00 UTC) before the one containing `now`. */
export function previousSampleWeek(now: Date): SampleWeek {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const end = today - ((now.getUTCDay() + 6) % 7) * DAY_MS
  const start = end - 7 * DAY_MS

  // The ISO week-year is the year of the week's Thursday.
  const thursday = new Date(start + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const januaryFirst = Date.UTC(year, 0, 1)
  const firstThursday = januaryFirst + ((4 - new Date(januaryFirst).getUTCDay() + 7) % 7) * DAY_MS
  const week = 1 + Math.floor((thursday.getTime() - firstThursday) / (7 * DAY_MS))

  return { key: `${year}-W${String(week).padStart(2, '0')}`, start: new Date(start), end: new Date(end) }
}

// Not a security control: the sample only has to be evenly spread and repeatable.
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Up to WEEKLY_SAMPLE_SIZE rows, chosen deterministically by the week key, in uploadedDocumentId order. */
export function selectWeeklySample<T extends { readonly uploadedDocumentId: string }>(
  weekKey: string,
  rows: readonly T[],
): readonly T[] {
  // Bottom-k: adding or removing one row changes at most one member of the sample.
  return rows
    .map((row) => ({ row, rank: fnv1a32(`${weekKey}:${row.uploadedDocumentId}`) }))
    .sort((a, b) => a.rank - b.rank || compareIds(a.row.uploadedDocumentId, b.row.uploadedDocumentId))
    .slice(0, WEEKLY_SAMPLE_SIZE)
    .map(({ row }) => row)
    .sort((a, b) => compareIds(a.uploadedDocumentId, b.uploadedDocumentId))
}
