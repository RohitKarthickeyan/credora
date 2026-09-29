import 'server-only'
import { compare, hash, truncates } from 'bcryptjs'

const COST = 12

// bcrypt silently ignores everything past 72 UTF-8 bytes, so two passwords sharing that prefix
// would match. A setter validates the length first; reaching this throw is a programmer error.
export function hashPassword(password: string): Promise<string> {
  if (truncates(password)) {
    throw new Error('Password exceeds bcrypt’s 72-byte limit; validate its length before hashing.')
  }
  return hash(password, COST)
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return compare(password, storedHash)
}
