import type { Principal, UserRole } from './role'

/**
 * The one place a staff principal is built, applied both at sign-in and on every request to a
 * `User` row just read (ADR-026). A caregiver principal needs a `caregiverId` a `User` row does
 * not have, and caregivers sign in by email code (T-021), so a `CAREGIVER` row is refused here.
 */
export function staffPrincipalFrom(user: {
  readonly id: string
  readonly agencyId: string
  readonly role: UserRole
  readonly isActive: boolean
}): Principal | null {
  if (!user.isActive || user.role === 'CAREGIVER') return null
  return { role: user.role, id: user.id, agencyId: user.agencyId }
}
