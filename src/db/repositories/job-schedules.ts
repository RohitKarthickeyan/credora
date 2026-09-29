import type { JobScheduleModel } from '../generated/models/JobSchedule'
import { prisma } from '../prisma'
import type { JobPayload } from './jobs'
import { isIdempotencyKeyConflict, jobPayloadSchema } from './jobs'

const SCHEDULE_KEY_CONSTRAINT = 'JobSchedule_agencyId_key_key'

type CreateScheduleInput = {
  readonly agencyId: string
  readonly key: string
  readonly jobType: string
  readonly payload: JobPayload
  readonly intervalSeconds: number
  /** The first occurrence. The cursor starts here; there is no separate anchor. */
  readonly firstOccurrenceAt: Date
  readonly endsAt?: Date
}

export type CreateScheduleResult = { readonly created: boolean; readonly scheduleId: string }

/** Idempotent on (agencyId, key): a second call changes nothing and returns created: false. */
export async function createSchedule(input: CreateScheduleInput): Promise<CreateScheduleResult> {
  try {
    const schedule = await prisma.jobSchedule.create({
      data: {
        agencyId: input.agencyId,
        key: input.key,
        jobType: input.jobType,
        payload: { ...input.payload },
        intervalSeconds: input.intervalSeconds,
        nextOccurrenceAt: input.firstOccurrenceAt,
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      },
      select: { id: true },
    })
    return { created: true, scheduleId: schedule.id }
  } catch (error) {
    if (!isIdempotencyKeyConflict(error, SCHEDULE_KEY_CONSTRAINT)) throw error

    const existing = await prisma.jobSchedule.findUniqueOrThrow({
      where: { agencyId_key: { agencyId: input.agencyId, key: input.key } },
      select: { id: true },
    })
    return { created: false, scheduleId: existing.id }
  }
}

export type DueSchedule = {
  readonly id: string
  readonly agencyId: string
  readonly key: string
  readonly jobType: string
  readonly payload: JobPayload
  readonly intervalSeconds: number
  readonly nextOccurrenceAt: Date
  readonly endsAt: Date | null
}

/**
 * Unscoped by design, the second such read after `claimJobs`: one tick sweeps every tenant,
 * and an agency-leading predicate would make `JobSchedule_nextOccurrenceAt_idx` useless for it.
 * It returns nothing to a user. Ordered by nextOccurrenceAt, so the most overdue go first.
 */
export async function listDueSchedules(now: Date, limit: number): Promise<readonly DueSchedule[]> {
  const rows = await prisma.jobSchedule.findMany({
    where: { nextOccurrenceAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    orderBy: [{ nextOccurrenceAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      agencyId: true,
      key: true,
      jobType: true,
      payload: true,
      intervalSeconds: true,
      nextOccurrenceAt: true,
      endsAt: true,
    },
  })
  return rows.map((row) => ({ ...row, payload: jobPayloadSchema.parse(row.payload) }))
}

export type AdvanceScheduleInput = {
  readonly agencyId: string
  readonly scheduleId: string
  /** The cursor value the caller observed. The update is conditional on it. */
  readonly from: Date
  readonly nextOccurrenceAt: Date
  readonly lastOccurrenceAt: Date
  readonly skipped: number
}

/**
 * false when another tick moved the cursor first; nothing was written. The compare-and-set is
 * what stops two interleaved ticks moving the cursor backwards and replaying an occurrence.
 */
export async function advanceSchedule(input: AdvanceScheduleInput): Promise<boolean> {
  const moved = await prisma.jobSchedule.updateMany({
    where: { agencyId: input.agencyId, id: input.scheduleId, nextOccurrenceAt: input.from },
    data: {
      nextOccurrenceAt: input.nextOccurrenceAt,
      lastOccurrenceAt: input.lastOccurrenceAt,
      skippedOccurrences: { increment: input.skipped },
    },
  })
  return moved.count === 1
}

export type EndedSchedule = {
  readonly jobType: string
  readonly key: string
  readonly lastOccurrenceAt: Date | null
}

/**
 * Set `endsAt = now` unless the schedule already ends at or before `now`, so a repeated call
 * never moves an end. Returns the schedule's identity whether or not it moved it, and `null`
 * when there is no such schedule.
 */
export async function endSchedule(
  agencyId: string,
  key: string,
  now: Date,
): Promise<EndedSchedule | null> {
  await prisma.jobSchedule.updateMany({
    where: { agencyId, key, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    data: { endsAt: now },
  })
  return prisma.jobSchedule.findUnique({
    where: { agencyId_key: { agencyId, key } },
    select: { jobType: true, key: true, lastOccurrenceAt: true },
  })
}

export function getScheduleByKey(agencyId: string, key: string): Promise<JobScheduleModel | null> {
  return prisma.jobSchedule.findUnique({ where: { agencyId_key: { agencyId, key } } })
}
