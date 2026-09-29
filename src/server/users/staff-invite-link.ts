import 'server-only'
import { writeAuditEntry } from '@/db/audit'
import { findPendingStaffUser, setInvitedStaffPassword } from '@/db/repositories/users'
import { newPasswordSchema } from '@/domain/auth/staff-user'
import { hashPassword } from '@/lib/password'
import type { LinkUseCase } from '@/server/auth/link-token'
import { defineLinkUseCase } from '@/server/auth/link-token'

export const viewStaffInvite: LinkUseCase<
  Record<string, never>,
  { readonly agencyName: string; readonly fullName: string; readonly email: string } | null
> = defineLinkUseCase('STAFF_INVITE', 'inspect', async ({ grant, tx }) =>
  findPendingStaffUser(tx, grant.agencyId, grant.userId),
)

/**
 * Set the invited user's first password. NOT_PENDING (a password already set, or deactivated
 * since the invite) still consumes the token, because run returns normally.
 */
export const acceptStaffInvite: LinkUseCase<
  { readonly password: string },
  { readonly status: 'SET'; readonly email: string } | { readonly status: 'NOT_PENDING' }
> = defineLinkUseCase('STAFF_INVITE', 'consume', async ({ grant, input, tx }) => {
  const passwordHash = await hashPassword(newPasswordSchema.parse(input.password))
  const user = await setInvitedStaffPassword(tx, grant.agencyId, grant.userId, passwordHash)
  if (user === null) return { status: 'NOT_PENDING' }

  await writeAuditEntry(tx, {
    agencyId: grant.agencyId,
    action: 'EDIT',
    entityType: 'USER',
    entityId: grant.userId,
    fieldName: 'passwordHash',
  })
  return { status: 'SET', email: user.email }
})
