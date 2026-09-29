import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findAlayaCareMapping } from '@/db/repositories/alayacare-mapping'
import { findAlayaCareSyncSubject, hasAgencySyncedToAlayaCare } from '@/db/repositories/alayacare-sync'
import { findCaregiverCredentials } from '@/db/repositories/credentials'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import { type AlayaCarePreview, previewAlayaCareSync } from '@/domain/sync/alayacare-preview'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { toSyncSourceCredential } from './alayacare-source'

type AlayaCareSyncPreview = AlayaCarePreview & {
  readonly caregiverId: string
  readonly name: string | null
  readonly mappingVersion: number
}

// The same reads runAlayaCareSync makes, so the preview cannot drift from the sync (ADR-136). The
// subject read opens its own transaction, so the VIEW is a second one, written before any value
// is returned; an id that is not this agency's writes none (ADR-094).
/** null for an id that is not a caregiver of the principal's agency (nothing audited). */
export const getAlayaCarePreview: UseCase<{ readonly caregiverId: string }, AlayaCareSyncPreview | null> =
  defineUseCase('caregiver.view', async ({ principal, input }) => {
    const { agencyId } = principal
    const { caregiverId } = input
    const subject = await findAlayaCareSyncSubject(agencyId, caregiverId)
    if (subject === null) return null

    await runInAuditedTransaction((tx) =>
      writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: caregiverId }),
    )

    const stored = await findAlayaCareMapping(agencyId)
    const credentials = (await findCaregiverCredentials(agencyId, caregiverId)).map(toSyncSourceCredential)
    const signedDocuments = await findSignedDocuments(agencyId, caregiverId)

    const { legalFirstName, legalLastName } = subject.profile
    const nameParts = [legalFirstName, legalLastName].filter((part) => part !== null)
    return {
      caregiverId,
      name: nameParts.length === 0 ? null : nameParts.join(' '),
      mappingVersion: stored.version,
      ...previewAlayaCareSync(stored.mapping, {
        profile: subject.profile,
        recordFields: subject.recordFields,
        credentials,
        signedDocuments,
      }),
    }
  })

/** True while the principal's agency has no SYNCED AlayaCare sync. Reads no caregiver data. */
export const isFirstAlayaCareSyncPending: UseCase<Record<string, never>, boolean> = defineUseCase(
  'clearance.view',
  async ({ principal }) => !(await hasAgencySyncedToAlayaCare(principal.agencyId)),
)
