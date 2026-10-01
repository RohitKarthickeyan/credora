import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { findDocumentToExtract, saveExtraction } from '@/db/repositories/extractions'
import { findIntakeIdentity } from '@/db/repositories/intake-identity'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { findKnownFields } from '@/domain/documents/ocr-fields'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { ExtractionResult } from '@/integrations/ports/extraction'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { AUTO_ACCEPT_DOCUMENT_JOB_TYPE } from '@/server/review/auto-accept-job'
import { JUDGE_DOCUMENT_JOB_TYPE } from '@/server/review/judge'

export const EXTRACT_DOCUMENT_JOB_TYPE = 'documents.extract'

// An OCR adapter returns text alone; its fields are found by looking for what intake says.
async function withKnownFields(
  agencyId: string,
  caregiverId: string,
  result: ExtractionResult,
): Promise<ExtractionResult> {
  if (result.fields.length > 0 || result.text === '') return result
  const { legalName, dateOfBirth } = await findIntakeIdentity(agencyId, caregiverId)
  if (legalName === null) return result
  const lines = result.text.split('\n').map((text) => ({ text, confidence: result.confidence }))
  return { ...result, fields: [...findKnownFields(lines, { legalName, dateOfBirth })] }
}

/**
 * Reads one uploaded document once. An already-extracted or deleted document ends the job, so a
 * re-delivery does nothing twice. The vendor is called outside any transaction; a
 * VendorUnavailableError escapes so the queue retries. The requirement instance is left PENDING
 * for T-074. A WITHDRAWN caregiver ends the job with no vendor call (ADR-079).
 */
export const extractDocumentJob = defineJobHandler({
  type: EXTRACT_DOCUMENT_JOB_TYPE,
  schema: z.object({ uploadedDocumentId: z.uuid() }),
  run: ({ uploadedDocumentId }, { agencyId }) =>
    runAsSystem(async () => {
      const document = await findDocumentToExtract(agencyId, uploadedDocumentId)
      if (document === null) return { status: 'ok' }
      const caregiver = await findCaregiverForSession(agencyId, document.caregiverId)
      if (caregiver === null || caregiver.stage === 'WITHDRAWN') return { status: 'ok' }

      const extracted = await getPort('extraction').extract({
        agencyId,
        caregiverId: document.caregiverId,
        storageKey: document.storageKey,
      })
      const result = await withKnownFields(agencyId, document.caregiverId, extracted)

      await runInAuditedTransaction(async (tx) => {
        await saveExtraction(agencyId, uploadedDocumentId, result)
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'CAREGIVER',
          entityId: document.caregiverId,
          fieldName: 'extractions',
        })
        if (result.confidence > 0 && result.text.trim() !== '') {
          await enqueueJobInTransaction(tx, {
            agencyId,
            type: JUDGE_DOCUMENT_JOB_TYPE,
            payload: { uploadedDocumentId },
            idempotencyKey: buildIdempotencyKey(JUDGE_DOCUMENT_JOB_TYPE, [uploadedDocumentId]),
          })
        } else {
          await enqueueJobInTransaction(tx, {
            agencyId,
            type: AUTO_ACCEPT_DOCUMENT_JOB_TYPE,
            payload: { uploadedDocumentId },
            idempotencyKey: buildIdempotencyKey(AUTO_ACCEPT_DOCUMENT_JOB_TYPE, [uploadedDocumentId]),
          })
        }
      })
      return { status: 'ok' }
    }),
})
