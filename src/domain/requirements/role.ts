import { CAREGIVER_ROLES, type CaregiverRole } from './vocabulary'

/** The highest certification held, in CAREGIVER_ROLES order; null when none (OPEN-QUESTIONS 223). */
export function caregiverRoleOf(certificationsHeld: readonly CaregiverRole[]): CaregiverRole | null {
  return CAREGIVER_ROLES.findLast((role) => certificationsHeld.includes(role)) ?? null
}
