import { z } from 'zod'

// Product-owner defaults in force (ADR-059). Five codes an hour at five attempts each bounds a
// targeted guess at 25 in a million per hour.
export const ONE_TIME_CODE_TTL_MS = 600_000
export const ONE_TIME_CODE_MAX_ATTEMPTS = 5
export const ONE_TIME_CODES_PER_HOUR = 5

export const oneTimeCodeSchema = z.string().trim().regex(/^\d{6}$/)

export type OneTimeCodeRefusal = 'USED' | 'EXPIRED' | 'LOCKED'

export function oneTimeCodeRefusal(
  code: { readonly expiresAt: Date; readonly attempts: number; readonly consumedAt: Date | null },
  now: Date,
): OneTimeCodeRefusal | null {
  if (code.consumedAt !== null) return 'USED'
  if (code.expiresAt <= now) return 'EXPIRED'
  if (code.attempts >= ONE_TIME_CODE_MAX_ATTEMPTS) return 'LOCKED'
  return null
}
