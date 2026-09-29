import type { AuditedTx } from '../audit'

export type ContactPreferencesRow = {
  readonly mobilePhone: string | null
  readonly email: string | null
}

export function findContactPreferences(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<ContactPreferencesRow | null> {
  return tx.contactRecord.findFirst({
    where: { agencyId, caregiverId },
    select: { mobilePhone: true, email: true },
  })
}

export async function changeEmail(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  email: string,
): Promise<boolean> {
  const { count } = await tx.contactRecord.updateMany({
    where: { agencyId, caregiverId },
    data: { email },
  })
  return count === 1
}
