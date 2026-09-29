import { z } from 'zod'
import { type AuditedTx, runInAuditedTransaction } from '../audit'
import type { JobModel } from '../generated/models/Job'
import { prisma } from '../prisma'

/** A reason longer than this is stored truncated on both `Job.lastError` and `JobAttempt.error`. */
export const MAX_ERROR_LENGTH = 2000

/**
 * Identifiers only — never a field value. The `payload` column is plaintext jsonb, so a value
 * put here is a value stored unencrypted (DATA-MODEL.md § Field-level encryption). A handler
 * re-reads the record through a repository at run time.
 */
export type JobPayload = Readonly<Record<string, string | number | boolean | null>>

export const jobPayloadSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)

export type JobState = JobModel['state']

export type EnqueueJobInput = {
  readonly agencyId: string
  readonly type: string
  readonly payload: JobPayload
  readonly idempotencyKey: string
  readonly maxAttempts?: number
  readonly runAt?: Date
}

type EnqueueResult = { readonly created: boolean; readonly jobId: string }

const IDEMPOTENCY_KEY_CONSTRAINT = 'Job_agencyId_idempotencyKey_key'

// Prisma 7 reaches Postgres through a driver adapter (ADR-009), and the adapter reports the
// violated index here rather than on the `meta.target` of older versions. Parsed rather than
// cast so a shape change fails the idempotent-enqueue test instead of silently turning every
// duplicate into a throw.
const uniqueViolationSchema = z.object({
  code: z.literal('P2002'),
  meta: z.object({
    driverAdapterError: z.object({
      cause: z.object({ constraint: z.object({ index: z.string() }) }),
    }),
  }),
})

// A conflict on an idempotency constraint is the idempotency mechanism, not a failure: the
// unit of work is already known. Checking then inserting instead would have a race exactly the
// width of the round trip, so the catch is the design (CONVENTIONS.md § Error handling: it
// does something other than rethrow).
export function isIdempotencyKeyConflict(error: unknown, constraint: string): boolean {
  const parsed = uniqueViolationSchema.safeParse(error)
  return (
    parsed.success && parsed.data.meta.driverAdapterError.cause.constraint.index === constraint
  )
}

/**
 * Hand one unit of work to the queue. A second enqueue of the same
 * `(agencyId, idempotencyKey)` returns `created: false` and the existing job id, whatever
 * state that job is in: it never revives a DEAD job, re-runs a SUCCEEDED one, or resets a
 * pending backoff. Reviving a dead job is `requeueJob`.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueResult> {
  try {
    const job = await prisma.job.create({
      data: {
        agencyId: input.agencyId,
        type: input.type,
        payload: { ...input.payload },
        idempotencyKey: input.idempotencyKey,
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
        ...(input.runAt === undefined ? {} : { nextAttemptAt: input.runAt }),
      },
      select: { id: true },
    })
    return { created: true, jobId: job.id }
  } catch (error) {
    if (!isIdempotencyKeyConflict(error, IDEMPOTENCY_KEY_CONSTRAINT)) throw error

    const existing = await prisma.job.findUniqueOrThrow({
      where: {
        agencyId_idempotencyKey: {
          agencyId: input.agencyId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    })
    return { created: false, jobId: existing.id }
  }
}

/**
 * Enqueue inside the caller's transaction, so the job commits or rolls back with the row it is
 * about. There is deliberately no conflict catch: inside a transaction a unique violation aborts
 * it, so a duplicate key fails the whole unit of work — correct, because the caller derives the
 * key from a row created in the same transaction. T-044's invite uses this; T-100's "enqueue in
 * the same transaction" as the sign-off is the other intended caller.
 */
export async function enqueueJobInTransaction(
  tx: AuditedTx,
  input: EnqueueJobInput,
): Promise<{ readonly jobId: string }> {
  const job = await tx.job.create({
    data: {
      agencyId: input.agencyId,
      type: input.type,
      payload: { ...input.payload },
      idempotencyKey: input.idempotencyKey,
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.runAt === undefined ? {} : { nextAttemptAt: input.runAt }),
    },
    select: { id: true },
  })
  return { jobId: job.id }
}

const claimedJobSchema = z.object({
  id: z.string(),
  agencyId: z.string(),
  type: z.string(),
  payload: z.unknown(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
})

export type ClaimedJob = z.infer<typeof claimedJobSchema>

export type ClaimJobsInput = {
  readonly now: Date
  readonly limit: number
  readonly workerId: string
  readonly leaseMs: number
}

/**
 * Take up to `limit` eligible jobs in one statement. `FOR UPDATE SKIP LOCKED` inside the CTE
 * is what stops two workers running the same job: a second claimer cannot lock a row this one
 * holds, and skips it rather than blocking. By commit the rows no longer satisfy the
 * `nextAttemptAt` predicate, so a third claimer arriving afterwards does not see them either.
 * Left at the default READ COMMITTED — SKIP LOCKED under REPEATABLE READ produces
 * serialization failures instead of throughput.
 *
 * `RUNNING` is in the predicate on purpose: while a job runs, `nextAttemptAt` is its lease
 * expiry, so a worker that dies mid-job is recovered by the next claimer rather than by a
 * reaper process.
 *
 * Raw SQL for the same reason as `src/db/maintenance.ts`: Prisma cannot express the locking
 * clause, and splitting it into a read and a write reintroduces the race. The instants are
 * bound as ISO-8601 text and cast, so what crosses the wire is unambiguously the injected UTC
 * instant rather than whatever local offset the driver would otherwise render.
 */
export async function claimJobs(input: ClaimJobsInput): Promise<readonly ClaimedJob[]> {
  const at = input.now.toISOString()
  const leaseExpiry = new Date(input.now.getTime() + input.leaseMs).toISOString()

  const rows = await prisma.$queryRaw`
    WITH eligible AS (
      SELECT id
      FROM core."Job"
      WHERE state IN ('PENDING', 'RUNNING')
        AND "nextAttemptAt" <= ${at}::timestamp
      ORDER BY "nextAttemptAt" ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${input.limit}
    )
    UPDATE core."Job" AS j
    SET state = 'RUNNING',
        "claimedAt" = ${at}::timestamp,
        "claimedBy" = ${input.workerId},
        "nextAttemptAt" = ${leaseExpiry}::timestamp,
        "updatedAt" = ${at}::timestamp
    FROM eligible
    WHERE j.id = eligible.id
    RETURNING j.id, j."agencyId", j.type, j.payload, j.attempts, j."maxAttempts"
  `

  return claimedJobSchema.array().parse(rows)
}

export type AttemptOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'retry'; readonly reason: string; readonly nextAttemptAt: Date }
  | { readonly kind: 'dead'; readonly reason: string }

export type FinishAttemptInput = {
  readonly agencyId: string
  readonly jobId: string
  /** The worker that claimed this attempt — `claimJobs`'s `workerId`, not a fresh value. */
  readonly workerId: string
  readonly attempt: number
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly outcome: AttemptOutcome
}

/**
 * `lost-lease` means the attempt ran but the job was no longer this worker's to move — it
 * outlived its lease and another worker has since claimed the row. It is expected and benign,
 * which is why it is a return value rather than a throw: `drainQueue` has no boundary to catch
 * at, and a handler that is slow is not a program error.
 */
export type FinishAttemptResult = 'recorded' | 'lost-lease'

type JobStateUpdate = {
  state: JobState
  attempts: number
  nextAttemptAt?: Date
  lastError?: string
  finishedAt: Date | null
}

function jobUpdateFor(input: FinishAttemptInput): JobStateUpdate {
  const { outcome } = input

  if (outcome.kind === 'succeeded') {
    return { state: 'SUCCEEDED', attempts: input.attempt, finishedAt: input.finishedAt }
  }
  if (outcome.kind === 'dead') {
    return {
      state: 'DEAD',
      attempts: input.attempt,
      lastError: outcome.reason.slice(0, MAX_ERROR_LENGTH),
      finishedAt: input.finishedAt,
    }
  }
  return {
    state: 'PENDING',
    attempts: input.attempt,
    nextAttemptAt: outcome.nextAttemptAt,
    lastError: outcome.reason.slice(0, MAX_ERROR_LENGTH),
    finishedAt: null,
  }
}

/**
 * Record one finished attempt and move the job, in one transaction: a job state with no attempt
 * row would make the log a false account of what happened.
 *
 * The job half is conditional on the lease still being held — `state = 'RUNNING'` *and* the
 * claimer still being this worker. Without it a worker that outlived its 5-minute lease would
 * overwrite the terminal state a second worker had already reached, moving a SUCCEEDED job back
 * to PENDING and running the handler a third time. Both halves of the predicate are needed:
 * `claimedBy` alone is only as strong as worker ids being distinct, which nothing enforces, and
 * `state` alone still lets the stale worker land first and reschedule a job the live worker is
 * mid-way through.
 *
 * The attempt row is written either way. It ran, so the log records it; suppressing it would
 * leave a double-run with no trace, which is the one thing that makes this class of bug
 * diagnosable after the fact.
 */
export function finishAttempt(input: FinishAttemptInput): Promise<FinishAttemptResult> {
  const reason = input.outcome.kind === 'succeeded' ? null : input.outcome.reason

  return runInAuditedTransaction(async (tx) => {
    await tx.jobAttempt.create({
      data: {
        agencyId: input.agencyId,
        jobId: input.jobId,
        attempt: input.attempt,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        succeeded: input.outcome.kind === 'succeeded',
        error: reason === null ? null : reason.slice(0, MAX_ERROR_LENGTH),
      },
    })

    const moved = await tx.job.updateMany({
      where: {
        agencyId: input.agencyId,
        id: input.jobId,
        state: 'RUNNING',
        claimedBy: input.workerId,
      },
      data: jobUpdateFor(input),
    })

    return moved.count === 0 ? 'lost-lease' : 'recorded'
  })
}

export type ListJobsFilter = { readonly state?: JobState; readonly limit?: number }

/** One agency's jobs, oldest first — the sync log and the dead-letter list read this. */
export function listJobs(agencyId: string, filter: ListJobsFilter = {}): Promise<JobModel[]> {
  return prisma.job.findMany({
    where: { agencyId, ...(filter.state === undefined ? {} : { state: filter.state }) },
    orderBy: { createdAt: 'asc' },
    ...(filter.limit === undefined ? {} : { take: filter.limit }),
  })
}

/**
 * Start a dead job over: a fresh retry budget from `now`, with `lastError` and the attempt log
 * left alone — why it died is the point of keeping them. Returns `null` unless the job is DEAD
 * and in this agency; requeueing a RUNNING job would double-run it. The state test is part of
 * the statement rather than a read followed by a write, so two coordinators pressing retry at
 * once revive it once.
 */
export async function requeueJob(
  agencyId: string,
  jobId: string,
  now: Date,
): Promise<JobModel | null> {
  const revived = await prisma.job.updateMany({
    where: { agencyId, id: jobId, state: 'DEAD' },
    data: {
      state: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      claimedAt: null,
      claimedBy: null,
      finishedAt: null,
    },
  })
  if (revived.count === 0) return null

  return prisma.job.findUnique({ where: { agencyId_id: { agencyId, id: jobId } } })
}

export type CancelJobResult = 'cancelled' | 'not-cancellable'

// One conditional statement, like requeueJob: telling "was running" apart from "was pending"
// would need a read before the write, which reopens the race this avoids. A RUNNING job's
// in-flight attempt still finishes; its finishAttempt then finds the lease gone and returns
// 'lost-lease', so the cancellation stands and the job is never retried.
async function cancelWhere(
  where: { agencyId: string } & ({ id: string } | { idempotencyKey: string }),
  now: Date,
): Promise<CancelJobResult> {
  const cancelled = await prisma.job.updateMany({
    where: { ...where, state: { in: ['PENDING', 'RUNNING'] } },
    data: { state: 'CANCELLED', finishedAt: now },
  })
  return cancelled.count === 0 ? 'not-cancellable' : 'cancelled'
}

export function cancelJobByIdempotencyKey(
  agencyId: string,
  idempotencyKey: string,
  now: Date,
): Promise<CancelJobResult> {
  return cancelWhere({ agencyId, idempotencyKey }, now)
}
