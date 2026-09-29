import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { changeEmail, findContactPreferences } from '@/db/repositories/contact-preferences'
import { isEmailInUse } from '@/db/repositories/invites'
import { correctEmailInputSchema } from '@/domain/pipeline/invite'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type CorrectEmailResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'UNCHANGED' | 'EMAIL_IN_USE' }

// Staff are the only path to change the sign-in email (ADR-087), so there is no re-verification.
// The parse trims and lower-cases the form's raw string.
export const correctEmail: UseCase<
  { readonly caregiverId: string; readonly email: string },
  CorrectEmailResult
> = defineUseCase('caregiver.correctEmail', async ({ principal, input }) => {
  const { caregiverId, email } = correctEmailInputSchema.parse(input)
  const { agencyId } = principal

  return runInAuditedTransaction(async (tx) => {
    const contact = await findContactPreferences(tx, agencyId, caregiverId)
    if (contact === null) return { ok: false, reason: 'NOT_FOUND' }
    if (contact.email === email) return { ok: false, reason: 'UNCHANGED' }
    if (await isEmailInUse(tx, agencyId, email)) {
      return { ok: false, reason: 'EMAIL_IN_USE' }
    }

    await changeEmail(tx, agencyId, caregiverId, email)
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: caregiverId,
      fieldName: 'email',
    })
    return { ok: true }
  })
})
