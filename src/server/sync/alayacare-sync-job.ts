import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findAlayaCareMapping } from '@/db/repositories/alayacare-mapping'
import {
  type AlayaCareSyncResult,
  findAlayaCareSyncSubject,
  finishAlayaCareSync,
  recordAlayaCareExternalId,
  startAlayaCareSync,
} from '@/db/repositories/alayacare-sync'
import { findAlayaCareProfileChoices } from '@/db/repositories/alayacare-sync-issues'
import { findCaregiverCredentials } from '@/db/repositories/credentials'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import { type AlayaCareProfileValues, type ProfileChoices, profileChoiceParts, reconcileAlayaCareProfile } from '@/domain/sync/alayacare-conflict'
import { type AlayaCareProjection, projectAlayaCareFields } from '@/domain/sync/alayacare-mapping'
import {
  type AlayaCareDocumentUpload,
  type AlayaCareProfileFields,
  projectAlayaCareProfile,
  signedDocumentsForAlayaCare,
  syncStageAction,
} from '@/domain/sync/alayacare-sync'
import type { AlayaCarePort, FieldConflict } from '@/integrations/ports/alayacare'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { type JobContext, type JobOutcome, defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { toSyncSourceCredential } from './alayacare-source'

export const ALAYACARE_SYNC_JOB_TYPE = 'sync.alayacare'

/** Identifiers only (ADR-016): the handler re-reads the caregiver, stage included, at run time. */
export type AlayaCareSyncPayload = { readonly caregiverId: string }

type Refusal =
  | { readonly status: 'conflict'; readonly conflicts: readonly FieldConflict[] }
  | { readonly status: 'rejected'; readonly reason: string }

type Stop = Exclude<AlayaCareSyncResult, { readonly status: 'SYNCED' }>

// Field names and AlayaCare's reason only: the reason becomes Job.lastError and the log's reason,
// neither of which may hold a caregiver value, so FieldConflict.ours/theirs are dropped here.
function conflictStop(step: string, conflictFields: readonly string[], credentialsWritten: number): Stop {
  return {
    status: 'CONFLICT',
    credentialsWritten,
    conflictFields,
    reason: `${step}: AlayaCare holds a different ${conflictFields.join(', ')}`,
  }
}

function stop(step: string, refusal: Refusal, credentialsWritten: number): Stop {
  if (refusal.status === 'rejected') {
    return { status: 'REJECTED', credentialsWritten, reason: `${step}: ${refusal.reason}` }
  }
  return conflictStop(step, refusal.conflicts.map((conflict) => conflict.field), credentialsWritten)
}

type SyncInput = {
  readonly caregiverId: string
  readonly known: string | null
  readonly profile: AlayaCareProfileFields
  readonly projection: AlayaCareProjection
  readonly documents: readonly AlayaCareDocumentUpload[]
  readonly choices: ProfileChoices
}

// Every key derives from jobId, one per distinct write (ADR-117), so a retry replays rather than
// duplicates. The profile key names the known id because a PUT must not reuse a POST's key, and
// the staff choices because each distinct decision is a distinct write (ADR-146).
async function writeToAlayaCare(
  alayacare: AlayaCarePort,
  { caregiverId, known, profile, projection, documents, choices }: SyncInput,
  { agencyId, jobId }: JobContext,
): Promise<AlayaCareSyncResult> {
  // A known employee is read and reconciled first, so no differing value is overwritten without a
  // staff choice (ADR-145). One AlayaCare no longer has goes out unchanged and its PUT is refused.
  let sent: AlayaCareProfileValues = profile
  if (known !== null) {
    const theirs = await alayacare.findProfile({ agencyId, lookup: { by: 'externalId', externalId: known } })
    if (theirs !== null) {
      const reconciled = reconcileAlayaCareProfile(profile, theirs, choices)
      if (!reconciled.ok) return conflictStop('profile', reconciled.conflicts, 0)
      sent = reconciled.profile
    }
  }
  const upserted = await alayacare.upsertProfile({
    agencyId,
    caregiverId,
    profile: { ...sent, externalId: known },
    idempotencyKey: buildIdempotencyKey('sync.alayacare.profile', [jobId, known ?? 'create', ...profileChoiceParts(choices)]),
  })
  if (upserted.status !== 'applied') return stop('profile', upserted, 0)

  const { externalId } = upserted.value
  // Recorded at once, so a later failure still leaves the id and the next attempt updates.
  if (externalId !== known) await recordAlayaCareExternalId(agencyId, jobId, externalId)

  let credentialsWritten = 0
  for (const mapped of projection.credentials) {
    const { credentialId, ...credential } = mapped
    const written = await alayacare.writeCredential({
      agencyId,
      externalId,
      credential,
      idempotencyKey: buildIdempotencyKey('sync.alayacare.credential', [jobId, credentialId]),
    })
    if (written.status !== 'applied') return stop(`credential ${credential.code}`, written, credentialsWritten)
    credentialsWritten += 1
  }

  for (const { signedDocumentId, templateKey, storageKey, filename } of documents) {
    const uploaded = await alayacare.uploadDocument({
      agencyId,
      externalId,
      storageKey,
      filename,
      idempotencyKey: buildIdempotencyKey('sync.alayacare.document', [jobId, signedDocumentId]),
    })
    if (uploaded.status !== 'applied') return stop(`document ${templateKey}`, uploaded, credentialsWritten)
  }

  if (Object.keys(projection.customFields).length > 0) {
    const written = await alayacare.writeCustomFields({
      agencyId,
      externalId,
      fields: projection.customFields,
      idempotencyKey: buildIdempotencyKey('sync.alayacare.customFields', [jobId]),
    })
    if (written.status !== 'applied') return stop('custom fields', written, credentialsWritten)
  }

  return { status: 'SYNCED', credentialsWritten }
}

function runAlayaCareSync(alayacare: AlayaCarePort, caregiverId: string, context: JobContext): Promise<JobOutcome> {
  const { agencyId, jobId, now } = context
  return runAsSystem(async () => {
    const subject = await findAlayaCareSyncSubject(agencyId, caregiverId)
    if (subject === null) return { status: 'ok' }

    const action = syncStageAction(subject.stage)
    if (action === 'SKIP') return { status: 'ok' }
    if (action === 'REFUSE') {
      return { status: 'fail', reason: `caregiver is at ${subject.stage}; only a signed-off caregiver is synced` }
    }

    const profile = projectAlayaCareProfile(subject.profile)
    if (!profile.ok) {
      return { status: 'fail', reason: `the caregiver's record has no ${profile.missing.join(', ')}; nothing was sent` }
    }

    const stored = await findAlayaCareMapping(agencyId)
    const credentials = (await findCaregiverCredentials(agencyId, caregiverId)).map(toSyncSourceCredential)
    const projection = projectAlayaCareFields(stored.mapping, { recordFields: subject.recordFields, credentials })
    const documents = signedDocumentsForAlayaCare(await findSignedDocuments(agencyId, caregiverId))

    const { externalId: known } = await startAlayaCareSync(agencyId, {
      caregiverId,
      jobId,
      mappingVersion: stored.version,
      unmappedCredentialTypes: projection.unmappedCredentialTypes,
      unresolvedCustomFields: projection.unresolvedCustomFields.map((field) => field.alayaCareKey),
      startedAt: now,
    })
    const choices = await findAlayaCareProfileChoices(agencyId, jobId)

    let result: AlayaCareSyncResult
    try {
      result = await writeToAlayaCare(alayacare, { caregiverId, known, profile: profile.profile, projection, documents, choices }, context)
    } catch (error) {
      if (error instanceof VendorUnavailableError) {
        return { status: 'retry', reason: error.message, retryAfterMs: error.retryAfterMs }
      }
      throw error
    }

    await runInAuditedTransaction(async (tx) => {
      await finishAlayaCareSync(tx, agencyId, { caregiverId, jobId, finishedAt: now, result })
      // A refusal is ALREADY_APPLIED (a redelivery) or TERMINAL_STAGE (withdrawn mid-sync); neither
      // is a failure of the sync.
      if (result.status === 'SYNCED') {
        await applyPipelineTransition(tx, agencyId, { caregiverId, event: 'SYNC_COMPLETED', actorUserId: null })
      }
    })
    return result.status === 'SYNCED' ? { status: 'ok' } : { status: 'fail', reason: result.reason }
  })
}

export const alayacareSyncJob = defineJobHandler({
  type: ALAYACARE_SYNC_JOB_TYPE,
  schema: z.object({ caregiverId: z.uuid() }) satisfies z.ZodType<AlayaCareSyncPayload>,
  run: ({ caregiverId }, context) => runAlayaCareSync(getPort('alayacare'), caregiverId, context),
})
