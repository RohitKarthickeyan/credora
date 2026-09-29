import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findCredentialSources, upsertCredentials } from '@/db/repositories/credentials'
import { projectCredentials } from '@/domain/requirements/credential'

/**
 * Not a use case: called only from inside T-101's guarded sign-off, whose transaction this
 * joins, so "cleared" and "credentials recorded" commit together (ADR-108).
 */
export function recordCaregiverCredentials(agencyId: string, caregiverId: string, signedOffAt: Date): Promise<void> {
  return runInAuditedTransaction(async (tx) => {
    const projected = projectCredentials(await findCredentialSources(agencyId, caregiverId))
    if (projected.length === 0) return

    await upsertCredentials(agencyId, caregiverId, projected, signedOffAt)
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: caregiverId,
      fieldName: 'credentials',
    })
  })
}
