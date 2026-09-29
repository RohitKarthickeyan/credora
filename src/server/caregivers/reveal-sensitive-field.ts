import 'server-only'
import { readSensitiveField } from '@/db/repositories/sensitive-field'
import type {
  RevealSensitiveFieldInput,
  SensitiveFieldReveal,
} from '@/domain/masking/sensitive-field'
import { revealSensitiveFieldInputSchema } from '@/domain/masking/sensitive-field'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is the principal's, never the input's: can() is not an agency check (T-014), so a
// caregiver id from another agency must read nothing. The input is parsed again because `field`
// arrives from a form and the type parameter is not a runtime check.
export const revealSensitiveField: UseCase<RevealSensitiveFieldInput, SensitiveFieldReveal> =
  defineUseCase('caregiverField.reveal', async ({ principal, input }) =>
    readSensitiveField(principal.agencyId, revealSensitiveFieldInputSchema.parse(input)),
  )
