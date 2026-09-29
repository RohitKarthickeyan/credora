import { createHash } from 'node:crypto'

/**
 * The key identifies the **unit of work**, not the entity: a key of `[caregiverId]` alone
 * would let a caregiver be synced exactly once ever. Callers derive it; the
 * `@@unique([agencyId, idempotencyKey])` constraint enforces it.
 *
 * Parts are hashed rather than concatenated so the key is bounded and so a part that is itself
 * an identifier does not leak into a log line. The NUL separator is why `['ab', 'c']` and
 * `['a', 'bc']` are different keys.
 */
export function buildIdempotencyKey(
  type: string,
  parts: readonly (string | number)[],
): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  return `${type}:${digest.slice(0, 32)}`
}
