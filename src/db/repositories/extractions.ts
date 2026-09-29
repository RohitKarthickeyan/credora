import { z } from 'zod'
import type { DocumentExtraction } from '@/domain/documents/extraction'
import { normaliseFields } from '@/domain/documents/extraction'
import type { ExtractionResult } from '@/integrations/ports/extraction'
import { extractedFieldSchema } from '@/integrations/ports/extraction'
import { parseStorageKey } from '@/integrations/ports/storage'
import { runInAuditedTransaction } from '../audit'
import { readClinicalDocumentText, saveClinicalDocumentText } from '../restricted/medical'

// ADR-068's one classification, read from the key's kind segment. Fail-closed: only a key
// positively of kind `upload` is personnel (ADR-082).
export function isClinical(storageKey: string): boolean {
  return parseStorageKey(storageKey)?.kind !== 'upload'
}

const EXTRACTION_SELECT = {
  confidence: true,
  fields: true,
  uploadedDocument: {
    select: {
      id: true,
      caregiverId: true,
      evidence: { select: { instanceId: true, evidenceKey: true } },
    },
  },
} as const

type ExtractionRow = {
  readonly confidence: number
  readonly fields: unknown
  readonly uploadedDocument: {
    readonly id: string
    readonly caregiverId: string
    readonly evidence: readonly { readonly instanceId: string; readonly evidenceKey: string }[]
  }
}

function toDocumentExtraction(row: ExtractionRow): DocumentExtraction {
  const { id, caregiverId, evidence } = row.uploadedDocument
  const [link, ...others] = evidence
  if (link === undefined || others.length > 0) {
    throw new Error(
      `Uploaded document ${id} has ${evidence.length} evidence rows; exactly one is expected (T-070).`,
    )
  }
  const fields = z.array(extractedFieldSchema).parse(row.fields)

  return {
    uploadedDocumentId: id,
    caregiverId,
    instanceId: link.instanceId,
    evidenceKey: link.evidenceKey,
    confidence: row.confidence,
    fields: normaliseFields(
      fields.map(({ name, value, confidence }) => ({ name, asPrinted: value, confidence })),
    ),
  }
}

/** Null when the document is gone, belongs to another agency, or is already extracted (OPEN-QUESTIONS 136). */
export function findDocumentToExtract(
  agencyId: string,
  uploadedDocumentId: string,
): Promise<{ readonly caregiverId: string; readonly storageKey: string } | null> {
  return runInAuditedTransaction((tx) =>
    tx.uploadedDocument.findFirst({
      where: { agencyId, id: uploadedDocumentId, extraction: { is: null } },
      select: { caregiverId: true, storageKey: true },
    }),
  )
}

/** Stores the reading as printed (ADR-083); a clinic result's text goes to the medical store. */
export function saveExtraction(
  agencyId: string,
  uploadedDocumentId: string,
  result: ExtractionResult,
): Promise<void> {
  return runInAuditedTransaction(async (tx) => {
    const document = await tx.uploadedDocument.findFirst({
      where: { agencyId, id: uploadedDocumentId },
      select: { caregiverId: true, storageKey: true },
    })
    if (document === null) {
      throw new Error(`Uploaded document ${uploadedDocumentId} was deleted before its extraction was saved.`)
    }
    const clinical = isClinical(document.storageKey)

    await tx.extraction.create({
      data: {
        agencyId,
        uploadedDocumentId,
        confidence: result.confidence,
        fields: result.fields,
        text: clinical ? null : result.text,
      },
    })
    if (clinical) {
      await saveClinicalDocumentText(agencyId, document.caregiverId, uploadedDocumentId, result.text)
    }
  })
}

export function findDocumentExtraction(
  agencyId: string,
  uploadedDocumentId: string,
): Promise<DocumentExtraction | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.extraction.findFirst({
      where: { agencyId, uploadedDocumentId },
      select: EXTRACTION_SELECT,
    })
    return row === null ? null : toDocumentExtraction(row)
  })
}

export function findCaregiverDocumentExtractions(
  agencyId: string,
  caregiverId: string,
): Promise<readonly DocumentExtraction[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.extraction.findMany({
      where: { agencyId, uploadedDocument: { caregiverId } },
      orderBy: [{ extractedAt: 'asc' }, { id: 'asc' }],
      select: EXTRACTION_SELECT,
    })
    return rows.map(toDocumentExtraction)
  })
}

/** The only way any task reads extracted text; for a clinic result it is an audited medical read. */
export function readExtractionText(
  agencyId: string,
  uploadedDocumentId: string,
): Promise<string | null> {
  return runInAuditedTransaction(async (tx) => {
    const document = await tx.uploadedDocument.findFirst({
      where: { agencyId, id: uploadedDocumentId },
      select: { caregiverId: true, storageKey: true, extraction: { select: { text: true } } },
    })
    if (document === null || document.extraction === null) return null
    if (isClinical(document.storageKey)) {
      return readClinicalDocumentText(agencyId, document.caregiverId, uploadedDocumentId)
    }
    return document.extraction.text
  })
}
