import { z } from 'zod'
import type { JobPayload } from '@/db/repositories/jobs'
import { DEFAULT_MAX_ATTEMPTS } from './backoff'

export type { JobPayload }

export type JobContext = {
  readonly agencyId: string
  readonly jobId: string
  readonly attempt: number
  readonly now: Date
}

/**
 * `retry` is transient — a 429, a 503, a timeout — and costs an attempt. `fail` is permanent
 * and dead-letters immediately: retrying an AlayaCare DOB conflict eight times produces eight
 * identical conflicts and a twenty-minute delay before a human hears about it.
 * `retryAfterMs` carries a vendor's `Retry-After`; it is clamped before use.
 */
export type JobOutcome =
  | { readonly status: 'ok' }
  | { readonly status: 'retry'; readonly reason: string; readonly retryAfterMs?: number }
  | { readonly status: 'fail'; readonly reason: string }

export type RegisteredJobHandler = {
  readonly type: string
  readonly maxAttempts: number
  readonly run: (payload: unknown, context: JobContext) => Promise<JobOutcome>
}

/**
 * The generic is erased here rather than in the registry's type: `run` is contravariant in its
 * payload, so a `JobHandler<SyncPayload>` is not assignable to a `JobHandler<JobPayload>`. The
 * definition site stays fully typed and the registry stays uniform, with no `any` between them.
 *
 * A payload that fails its schema is `fail`, not `retry`: a malformed payload will never become
 * well-formed.
 */
export function defineJobHandler<P extends JobPayload>(spec: {
  readonly type: string
  readonly schema: z.ZodType<P>
  readonly maxAttempts?: number
  readonly run: (payload: P, context: JobContext) => Promise<JobOutcome>
}): RegisteredJobHandler {
  return {
    type: spec.type,
    maxAttempts: spec.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    run: async (payload, context) => {
      const parsed = spec.schema.safeParse(payload)
      if (!parsed.success) {
        return {
          status: 'fail',
          reason: `payload does not match the schema for "${spec.type}": ${z.prettifyError(parsed.error)}`,
        }
      }
      return spec.run(parsed.data, context)
    },
  }
}

export type JobRegistry = ReadonlyMap<string, RegisteredJobHandler>

export function createJobRegistry(handlers: readonly RegisteredJobHandler[]): JobRegistry {
  const registry = new Map<string, RegisteredJobHandler>()

  for (const handler of handlers) {
    if (registry.has(handler.type)) {
      throw new Error(`Two job handlers are registered for the type "${handler.type}".`)
    }
    registry.set(handler.type, handler)
  }

  return registry
}
