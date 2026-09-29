import type { StorageKey } from '@/integrations/ports/storage'
import type { AuditedTx } from '../audit'
import { prisma } from '../prisma'

export type StoredSignedDocument = {
  readonly id: string
  /** The document key. */
  readonly templateKey: string
  readonly templateVersion: string
  /** The provider's envelope id, not our Envelope.id. */
  readonly envelopeId: string
  readonly signedPdfKey: StorageKey
  readonly signedAt: Date
}

export function findSignedDocuments(
  agencyId: string,
  caregiverId: string,
): Promise<readonly StoredSignedDocument[]> {
  return prisma.signedDocument.findMany({
    where: { agencyId, caregiverId },
    select: {
      id: true,
      templateKey: true,
      templateVersion: true,
      envelopeId: true,
      signedPdfKey: true,
      signedAt: true,
    },
    orderBy: { templateKey: 'asc' },
  })
}

export async function createSignedDocument(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  input: Omit<StoredSignedDocument, 'id'>,
): Promise<{ readonly id: string }> {
  return tx.signedDocument.create({
    data: { agencyId, caregiverId, ...input },
    select: { id: true },
  })
}
