import type { QueueDocument } from '@/domain/documents/exception-queue'
import { prisma } from '../prisma'
import { DOCUMENT_SELECT, toQueueDocument } from './exception-queue'
import { isClinical } from './extractions'

export type AutoAcceptedDocumentRow = QueueDocument & { readonly acceptedAt: Date; readonly clinical: boolean }

/** Documents whose auto-accept decision in the window satisfied their requirement, withdrawn caregivers included (ADR-109). */
export async function findAutoAcceptedDocumentRows(
  agencyId: string,
  window: { readonly start: Date; readonly end: Date },
): Promise<readonly AutoAcceptedDocumentRow[]> {
  const rows = await prisma.autoAcceptDecision.findMany({
    where: {
      agencyId,
      staffReasons: { isEmpty: true },
      instanceStatusSet: 'SATISFIED',
      decidedAt: { gte: window.start, lt: window.end },
    },
    select: { decidedAt: true, uploadedDocument: { select: DOCUMENT_SELECT } },
  })

  return rows.map(({ decidedAt, uploadedDocument }) => ({
    ...toQueueDocument(uploadedDocument),
    acceptedAt: decidedAt,
    clinical: isClinical(uploadedDocument.storageKey),
  }))
}
