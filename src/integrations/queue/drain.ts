import type { ClaimedJob } from '@/db/repositories/jobs'
import { claimJobs, finishAttempt } from '@/db/repositories/jobs'
import { BACKOFF_CAP_MS, CLAIM_LEASE_MS, backoffDelayMs } from './backoff'
import type { JobContext, JobOutcome, JobRegistry } from './handler'

/** The only source of time in the queue. A production caller passes `() => new Date()`. */
export type Clock = () => Date

export type DrainQueueInput = {
  readonly registry: JobRegistry
  readonly clock: Clock
  readonly limit: number
  readonly workerId: string
}

export type DrainSummary = {
  readonly claimed: number
  readonly succeeded: number
  readonly retried: number
  readonly deadLettered: number
}

// An unregistered type is permanent, not transient: with a static registry in a single process
// it can only mean a programmer error, and dead-lettering makes it loud immediately instead of
// twenty minutes later. Revisit under rolling deploys, where an unknown type can mean "the
// handler ships in the next instance".
async function runHandler(
  registry: JobRegistry,
  job: ClaimedJob,
  context: JobContext,
): Promise<JobOutcome> {
  const handler = registry.get(job.type)
  if (handler === undefined) {
    return { status: 'fail', reason: `No handler is registered for the job type "${job.type}".` }
  }

  try {
    return await handler.run(job.payload, context)
  } catch (error) {
    // An exception is an outcome we did not model, so it is transient by default and the
    // attempt log is where it is recorded once.
    return { status: 'retry', reason: error instanceof Error ? error.message : String(error) }
  }
}

function retryDelayMs(outcome: JobOutcome & { status: 'retry' }, attempt: number): number {
  if (outcome.retryAfterMs === undefined) return backoffDelayMs(attempt)
  return Math.min(Math.max(outcome.retryAfterMs, 0), BACKOFF_CAP_MS)
}

/**
 * Claim up to `limit` eligible jobs and run each to a terminal or rescheduled state, then
 * return. It does not loop, sleep or poll: it is the unit of work every possible runner is
 * built from. Nothing calls it outside tests yet — choosing the production entry point is a
 * hosting decision and none of the candidates changes a line of this function.
 */
export async function drainQueue(input: DrainQueueInput): Promise<DrainSummary> {
  const startedAt = input.clock()
  const claimed = await claimJobs({
    now: startedAt,
    limit: input.limit,
    workerId: input.workerId,
    leaseMs: CLAIM_LEASE_MS,
  })

  let succeeded = 0
  let retried = 0
  let deadLettered = 0

  for (const job of claimed) {
    const attempt = job.attempts + 1
    const context: JobContext = {
      agencyId: job.agencyId,
      jobId: job.id,
      attempt,
      now: startedAt,
    }

    const outcome = await runHandler(input.registry, job, context)
    const finishedAt = input.clock()
    const common = {
      agencyId: job.agencyId,
      jobId: job.id,
      workerId: input.workerId,
      attempt,
      startedAt,
      finishedAt,
    }

    // A `lost-lease` result is counted in none of the three: this drain outlived its lease and
    // another worker already moved the job, so it moved nothing. That is why `claimed` can
    // exceed the three outcomes added together — the gap is the races this worker lost.
    if (outcome.status === 'ok') {
      const result = await finishAttempt({ ...common, outcome: { kind: 'succeeded' } })
      if (result === 'recorded') succeeded += 1
      continue
    }

    if (outcome.status === 'fail' || attempt >= job.maxAttempts) {
      const result = await finishAttempt({
        ...common,
        outcome: { kind: 'dead', reason: outcome.reason },
      })
      if (result === 'recorded') deadLettered += 1
      continue
    }

    const result = await finishAttempt({
      ...common,
      outcome: {
        kind: 'retry',
        reason: outcome.reason,
        nextAttemptAt: new Date(finishedAt.getTime() + retryDelayMs(outcome, attempt)),
      },
    })
    if (result === 'recorded') retried += 1
  }

  return { claimed: claimed.length, succeeded, retried, deadLettered }
}
