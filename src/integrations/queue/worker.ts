import type { Clock } from './drain'
import { drainQueue } from './drain'
import type { JobRegistry } from './handler'
import { runScheduleTick } from './schedule'

const POLL_INTERVAL_MS = 5_000
const BATCH_LIMIT = 10

export type RunWorkerInput = {
  readonly registry: JobRegistry
  readonly clock: Clock
  readonly workerId: string
  readonly signal: AbortSignal
}

function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * Resolves once `signal` is aborted and the cycle in progress has finished. A failing queue
 * rejects it deliberately: the process manager restarts the worker and the lease recovers the job.
 */
export async function runWorker(input: RunWorkerInput): Promise<void> {
  const { registry, clock, workerId, signal } = input

  while (!signal.aborted) {
    // Tick before drain, so an occurrence that comes due runs in the same cycle (ADR-029).
    const tick = await runScheduleTick({ clock, limit: BATCH_LIMIT })
    const drain = await drainQueue({ registry, clock, limit: BATCH_LIMIT, workerId })

    if (tick.enqueued > 0 || drain.claimed > 0) {
      console.info(
        `[worker ${workerId}] schedules due ${tick.schedulesDue}, enqueued ${tick.enqueued}, ` +
          `already enqueued ${tick.alreadyEnqueued}, skipped ${tick.skipped}; ` +
          `claimed ${drain.claimed}, succeeded ${drain.succeeded}, retried ${drain.retried}, ` +
          `dead-lettered ${drain.deadLettered}`,
      )
    }

    if (!signal.aborted) await waitUnlessAborted(POLL_INTERVAL_MS, signal)
  }
}
