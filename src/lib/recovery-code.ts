import 'server-only'
import { createHash, randomInt } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// 16 characters of a 32-letter alphabet is 80 random bits: too many to reverse an unkeyed
// SHA-256 by enumeration, unlike a 6-digit code (contrast otp.ts).
export function generateRecoveryCode(): string {
  return Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}
