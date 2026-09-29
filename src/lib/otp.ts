import 'server-only'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { env } from './env'

export function generateOneTimeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

// Keyed, because 10^6 codes make a plain SHA-256 reversible by anyone who can read the table.
// The label separates this use of SESSION_SECRET from JWT signing (ADR-059).
export function hashOneTimeCode(subjectId: string, code: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`credora.one-time-code\0${subjectId}\0${code}`)
    .digest('hex')
}

export function oneTimeCodeMatches(codeHash: string, subjectId: string, code: string): boolean {
  const expected = Buffer.from(hashOneTimeCode(subjectId, code), 'hex')
  const actual = Buffer.from(codeHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
