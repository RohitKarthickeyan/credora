import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import {
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import {
  type OwnUpload,
  createUploadedDocument,
  findDocumentRequests,
  findOwnUploads,
} from '@/db/repositories/uploaded-documents'
import type { DocumentRequest, UploadRefusal } from '@/domain/documents/upload'
import { checkUploadBytes, isClinicalUpload, uploadRefusal } from '@/domain/documents/upload'
import type { StoragePort } from '@/integrations/ports/storage'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { EXTRACT_DOCUMENT_JOB_TYPE } from './extraction-job'

export const viewOwnDocumentRequests: UseCase<
  { readonly caregiverId: string },
  readonly DocumentRequest[]
> = defineUseCase('caregiver.viewOwn', async ({ principal, input }) =>
  runInAuditedTransaction(async (tx) => {
    const requests = await findDocumentRequests(principal.agencyId, input.caregiverId)
    await writeAuditEntry(tx, {
      agencyId: principal.agencyId,
      action: 'VIEW',
      entityType: 'CAREGIVER',
      entityId: input.caregiverId,
    })
    return requests
  }),
)

// Data class OWN_RECORD: the list reads no bytes, so a clinical upload is listed like any other (ADR-135).
export const viewOwnUploads: UseCase<{ readonly caregiverId: string }, readonly OwnUpload[]> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) =>
    runInAuditedTransaction(async (tx) => {
      const uploads = await findOwnUploads(principal.agencyId, input.caregiverId)
      await writeAuditEntry(tx, {
        agencyId: principal.agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: input.caregiverId,
      })
      return uploads
    }),
)

export type UploadOwnDocumentResult =
  | { readonly ok: true; readonly uploadedDocumentId: string }
  | {
      readonly ok: false
      readonly refusal: 'NOT_FOUND' | UploadRefusal | 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_FORMAT'
    }

/**
 * The bytes are written between two transactions so no connection is held across I/O. If the
 * second transaction throws, the object is orphaned under the caregiver's own prefix with no row
 * (T-070 § Risks 2).
 */
export const uploadOwnDocument: UseCase<
  {
    readonly caregiverId: string
    readonly instanceId: string
    readonly evidenceKey: string
    readonly bytes: Uint8Array
    readonly storage: StoragePort
  },
  UploadOwnDocumentResult
> = defineUseCase('caregiver.editOwn', async ({ principal, input }) => {
  const { agencyId } = principal
  const { caregiverId, instanceId, evidenceKey } = input

  const check = checkUploadBytes(input.bytes)
  if (!check.ok) return check

  const requests = await findDocumentRequests(agencyId, caregiverId)
  const request = requests.find((candidate) => candidate.instanceId === instanceId)
  if (request === undefined) return { ok: false, refusal: 'NOT_FOUND' }
  const refusal = uploadRefusal(request, evidenceKey)
  if (refusal !== null) return { ok: false, refusal }

  const storageKey = await input.storage.write(
    {
      agencyId,
      caregiverId,
      kind: isClinicalUpload(evidenceKey) ? 'clinical' : 'upload',
      extension: check.format,
    },
    input.bytes,
  )

  return runInAuditedTransaction(async (tx) => {
    const document = await createUploadedDocument(agencyId, caregiverId, storageKey)
    const link = await linkEvidence(agencyId, instanceId, evidenceKey, {
      kind: 'UPLOADED_DOCUMENT',
      uploadedDocumentId: document.id,
    })
    if (!link.ok) {
      throw new Error(`Requirement instance ${instanceId} stopped accepting ${evidenceKey} mid-upload.`)
    }
    const change = await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING')
    if (!change.ok && change.refusal !== 'ALREADY_IN_STATUS') {
      throw new Error(
        `Requirement instance ${instanceId} moved to ${change.from} mid-upload; a concurrent ` +
          'writer changed it.',
      )
    }
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: caregiverId,
      fieldName: 'uploadedDocuments',
    })
    await enqueueJobInTransaction(tx, {
      agencyId,
      type: EXTRACT_DOCUMENT_JOB_TYPE,
      payload: { uploadedDocumentId: document.id },
      idempotencyKey: buildIdempotencyKey(EXTRACT_DOCUMENT_JOB_TYPE, [document.id]),
    })
    return { ok: true, uploadedDocumentId: document.id }
  })
})
