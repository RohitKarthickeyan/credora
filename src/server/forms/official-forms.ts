import { findOfficialFormRecord } from '@/db/repositories/official-form-record'
import { readSealedFormValues } from '@/db/repositories/sealed-form-values'
import type { DocumentSetEntry } from '@/domain/documents/document-set'
import type { OfficialFormRefusal } from '@/domain/documents/official-form'
import { fillOfficialForms, sealedFieldsFor } from '@/domain/documents/official-forms'
import type { StoragePort } from '@/integrations/ports/storage'
import type { GeneratedDocument } from './agency-documents'
import { composeDocumentPdf } from './compose-pdf'
import { fillAcroForm } from './fill-acroform'

export type OfficialFormsResult =
  | { readonly ok: true; readonly documents: readonly GeneratedDocument[] }
  | { readonly ok: false; readonly reason: 'unknown-caregiver' }
  | {
      readonly ok: false
      readonly reason: 'refused'
      readonly refusals: readonly OfficialFormRefusal[]
    }

// Not a use case: T-064's send owns authorisation and the export audit entry. It prints decrypted
// values, so keep its importers few (ADR-069).
export async function generateOfficialForms(
  agencyId: string,
  caregiverId: string,
  entries: readonly DocumentSetEntry[],
  storage: StoragePort,
): Promise<OfficialFormsResult> {
  const record = await findOfficialFormRecord(agencyId, caregiverId)
  if (record === null) return { ok: false, reason: 'unknown-caregiver' }

  const sealed = await readSealedFormValues(
    agencyId,
    caregiverId,
    sealedFieldsFor(entries, record),
    entries.map((entry) => entry.documentKey),
  )

  const filled = fillOfficialForms(entries, record, sealed)
  if (!filled.ok) return { ok: false, reason: 'refused', refusals: filled.refusals }

  const documents: GeneratedDocument[] = []
  for (const fill of filled.fills) {
    const { documentKey, templateVersion, title } = fill.kind === 'acroform' ? fill : fill.document
    const bytes = fill.kind === 'acroform' ? await fillAcroForm(fill) : await composeDocumentPdf(fill.document)
    const unsignedPdfKey = await storage.write(
      { agencyId, caregiverId, kind: 'generated', extension: 'pdf' },
      bytes,
    )
    documents.push({ documentKey, templateVersion, name: title, unsignedPdfKey })
  }

  return { ok: true, documents }
}
