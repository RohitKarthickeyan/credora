import { z } from 'zod'
import { findAgencyDocumentContext } from '@/db/repositories/agency-document-context'
import { type DocumentRefusal, renderDocuments } from '@/domain/documents/agency-document'
import type { DocumentSetEntry } from '@/domain/documents/document-set'
import { AGENCY_TEMPLATES } from '@/domain/documents/agency-templates'
import type { StorageKey, StoragePort } from '@/integrations/ports/storage'
import { composeDocumentPdf } from './compose-pdf'

export type GeneratedDocument = {
  readonly documentKey: string
  readonly templateVersion: string
  readonly name: string
  readonly unsignedPdfKey: StorageKey
}

export type AgencyDocumentsResult =
  | { readonly ok: true; readonly documents: readonly GeneratedDocument[] }
  | { readonly ok: false; readonly reason: 'unknown-caregiver' }
  | { readonly ok: false; readonly reason: 'refused'; readonly refusals: readonly DocumentRefusal[] }

// Not a use case: T-064's send owns authorisation and the export audit entry.
export async function generateAgencyDocuments(
  agencyId: string,
  caregiverId: string,
  entries: readonly DocumentSetEntry[],
  issuedOn: string,
  storage: StoragePort,
): Promise<AgencyDocumentsResult> {
  z.iso.date().parse(issuedOn)

  const context = await findAgencyDocumentContext(agencyId, caregiverId)
  if (context === null) return { ok: false, reason: 'unknown-caregiver' }

  const rendered = renderDocuments(AGENCY_TEMPLATES, entries, context, issuedOn)
  if (!rendered.ok) return { ok: false, reason: 'refused', refusals: rendered.refusals }

  const documents: GeneratedDocument[] = []
  for (const document of rendered.documents) {
    const bytes = await composeDocumentPdf(document)
    const unsignedPdfKey = await storage.write(
      { agencyId, caregiverId, kind: 'generated', extension: 'pdf' },
      bytes,
    )
    documents.push({
      documentKey: document.documentKey,
      templateVersion: document.templateVersion,
      name: document.title,
      unsignedPdfKey,
    })
  }

  return { ok: true, documents }
}
