import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findContactPreferences } from '@/db/repositories/contact-preferences'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type ContactPreferences = {
  readonly email: string | null
}

export const viewOwnContactPreferences: UseCase<
  { readonly caregiverId: string },
  ContactPreferences
> = defineUseCase('caregiver.viewOwn', async ({ principal, input }) =>
  runInAuditedTransaction(async (tx) => {
    const contact = await findContactPreferences(tx, principal.agencyId, input.caregiverId)
    await writeAuditEntry(tx, {
      agencyId: principal.agencyId,
      action: 'VIEW',
      entityType: 'CAREGIVER',
      entityId: input.caregiverId,
    })
    return { email: contact?.email ?? null }
  }),
)
