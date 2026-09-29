const BACKOFF_BASE_MS = 10_000
const BACKOFF_FACTOR = 2
export const BACKOFF_CAP_MS = 600_000
export const DEFAULT_MAX_ATTEMPTS = 8

/**
 * How long a claimed job stays invisible to other claimers. A handler that outlives its lease
 * will be started a second time while the first run is still going; that is survivable only
 * because every handler must already be idempotent to survive retries at all. A handler that
 * needs longer than this should be split into two jobs.
 */
export const CLAIM_LEASE_MS = 300_000

/**
 * Wait before the next attempt, given the attempt that has just finished (1-based):
 * 10s, 20s, 40s, 80s, 160s, 320s, then capped at 600s.
 *
 * No jitter. Determinism is a stated value of this repo (INTEGRATIONS.md § Rules bullet 4) and
 * jitter would make the schedule probabilistic; with a bounded batch there is no herd to
 * spread. Revisit when more than one worker process runs.
 */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempt - 1), BACKOFF_CAP_MS)
}
