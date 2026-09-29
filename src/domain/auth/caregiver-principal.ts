import type { PipelineStage } from '../pipeline/stage'
import type { Principal } from './role'

export type CaregiverPrincipal = Extract<Principal, { role: 'CAREGIVER' }>

/**
 * The one place a caregiver principal is built, applied at sign-in and on every request to a
 * `Caregiver` row just read. The audit actor id is the caregiver id: caregivers have no `User`
 * row. Every stage but the terminal WITHDRAWN signs in, ACTIVE included (T-131).
 */
export function caregiverPrincipalFrom(caregiver: {
  readonly id: string
  readonly agencyId: string
  readonly stage: PipelineStage
}): CaregiverPrincipal | null {
  if (caregiver.stage === 'WITHDRAWN') return null
  return {
    role: 'CAREGIVER',
    id: caregiver.id,
    agencyId: caregiver.agencyId,
    caregiverId: caregiver.id,
  }
}
