import { advanceSchedule, endSchedule, listDueSchedules } from '@/db/repositories/job-schedules'
import { cancelJobByIdempotencyKey, enqueueJob } from '@/db/repositories/jobs'
import type { Clock } from './drain'
import { buildIdempotencyKey } from './idempotency'

/**
 * An instant, not a date: a sub-daily schedule keyed by date would collapse every occurrence in
 * a day into one job and then stop forever.
 */
function scheduleOccurrenceKey(
  jobType: string,
  scheduleKey: string,
  occurrenceAt: Date,
): string {
  return buildIdempotencyKey(jobType, [scheduleKey, occurrenceAt.toISOString()])
}

export type ScheduleWindow =
  | { readonly kind: 'not-due' }
  | {
      readonly kind: 'due'
      /** The most recent occurrence at or before `now`. Goes in the idempotency key. */
      readonly occurrenceAt: Date
      /** Occurrences before it that came due and are deliberately not being enqueued. */
      readonly skipped: number
      /** The cursor's new value: `occurrenceAt` plus one interval. */
      readonly nextOccurrenceAt: Date
    }

/**
 * Missed occurrences are skipped, not replayed: every consumer processes whatever is outstanding
 * when it runs, so replaying a long weekend's windows would send the same reminder four times.
 * Only the most recent due occurrence is returned, and the rest are counted.
 */
function resolveScheduleWindow(input: {
  readonly intervalSeconds: number
  readonly nextOccurrenceAt: Date
  readonly endsAt: Date | null
  readonly now: Date
}): ScheduleWindow {
  const now = input.now.getTime()
  const cursor = input.nextOccurrenceAt.getTime()
  if (cursor > now || (input.endsAt !== null && input.endsAt.getTime() <= now)) {
    return { kind: 'not-due' }
  }

  const interval = input.intervalSeconds * 1000
  const skipped = Math.floor((now - cursor) / interval)
  const occurrenceAt = cursor + skipped * interval
  return {
    kind: 'due',
    occurrenceAt: new Date(occurrenceAt),
    skipped,
    nextOccurrenceAt: new Date(occurrenceAt + interval),
  }
}

export type ScheduleTickInput = {
  readonly clock: Clock
  readonly limit: number
}

export type ScheduleTickSummary = {
  readonly schedulesDue: number
  /** enqueueJob returned `created: true`. */
  readonly enqueued: number
  /** enqueueJob returned `created: false` — the occurrence key did its job. */
  readonly alreadyEnqueued: number
  /** Occurrences skipped this tick, summed across schedules. */
  readonly skipped: number
}

/**
 * Enqueue the due occurrence of up to `limit` schedules, across every agency, then return. Like
 * `drainQueue` it does not loop, sleep or poll, and nothing calls it outside tests yet. A cycle
 * is this, then `drainQueue`.
 *
 * Each schedule is enqueued *before* its cursor is advanced. A crash between the two costs one
 * duplicate enqueue on the next tick, which the occurrence key turns into a no-op; the other
 * order would lose the occurrence silently. The same key and the compare-and-set on the cursor
 * make two concurrent ticks safe without a lock.
 */
export async function runScheduleTick(input: ScheduleTickInput): Promise<ScheduleTickSummary> {
  const now = input.clock()
  const due = await listDueSchedules(now, input.limit)

  let schedulesDue = 0
  let enqueued = 0
  let alreadyEnqueued = 0
  let skipped = 0

  for (const schedule of due) {
    const window = resolveScheduleWindow({ ...schedule, now })
    if (window.kind === 'not-due') continue
    schedulesDue += 1

    const { created } = await enqueueJob({
      agencyId: schedule.agencyId,
      type: schedule.jobType,
      payload: schedule.payload,
      idempotencyKey: scheduleOccurrenceKey(schedule.jobType, schedule.key, window.occurrenceAt),
      runAt: window.occurrenceAt,
    })
    if (created) enqueued += 1
    else alreadyEnqueued += 1

    const advanced = await advanceSchedule({
      agencyId: schedule.agencyId,
      scheduleId: schedule.id,
      from: schedule.nextOccurrenceAt,
      nextOccurrenceAt: window.nextOccurrenceAt,
      lastOccurrenceAt: window.occurrenceAt,
      skipped: window.skipped,
    })
    if (advanced) skipped += window.skipped
  }

  return { schedulesDue, enqueued, alreadyEnqueued, skipped }
}

export type StopScheduleResult = { readonly ended: boolean; readonly cancelledJob: boolean }

/**
 * End the schedule, then cancel the job still outstanding for its most recent occurrence. Two
 * writes in two repositories and deliberately not one transaction: ending first means a crash
 * between them leaves no future occurrence and at most one enqueued job, and calling this again
 * completes it because both writes are idempotent. Cancellation stops the future, not the
 * present — an attempt already running finishes.
 */
export async function stopSchedule(
  agencyId: string,
  key: string,
  now: Date,
): Promise<StopScheduleResult> {
  const ended = await endSchedule(agencyId, key, now)
  if (ended === null) return { ended: false, cancelledJob: false }
  if (ended.lastOccurrenceAt === null) return { ended: true, cancelledJob: false }

  const result = await cancelJobByIdempotencyKey(
    agencyId,
    scheduleOccurrenceKey(ended.jobType, ended.key, ended.lastOccurrenceAt),
    now,
  )
  return { ended: true, cancelledJob: result === 'cancelled' }
}
