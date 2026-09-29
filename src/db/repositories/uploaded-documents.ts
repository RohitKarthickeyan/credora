import type { DocumentRequest } from '@/domain/documents/upload'
import { runInAuditedTransaction } from '../audit'

type StoredUploadedDocument = {
  readonly id: string
  readonly storageKey: string
}

export type OwnUpload = {
  readonly uploadedDocumentId: string
  readonly requirementName: string | null
  readonly uploadedAt: Date
}

const UPLOADED = { kind: 'UPLOADED_DOCUMENT' } as const

export function findDocumentRequests(
  agencyId: string,
  caregiverId: string,
): Promise<readonly DocumentRequest[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, caregiverId, template: { acceptedEvidence: { some: UPLOADED } } },
      orderBy: { templateKey: 'asc' },
      include: {
        template: {
          select: {
            name: true,
            acceptedEvidence: {
              where: UPLOADED,
              select: { evidenceKey: true, label: true },
              orderBy: { evidenceKey: 'asc' },
            },
          },
        },
        _count: { select: { evidence: { where: UPLOADED } } },
      },
    })

    return rows.map((row) => ({
      instanceId: row.id,
      templateKey: row.templateKey,
      name: row.template.name,
      status: row.status,
      options: row.template.acceptedEvidence,
      uploadCount: row._count.evidence,
    }))
  })
}

// Never selects storageKey: the caregiver sees that a file was received, not the file (OPEN-QUESTIONS 221).
export function findOwnUploads(agencyId: string, caregiverId: string): Promise<readonly OwnUpload[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.uploadedDocument.findMany({
      where: { agencyId, caregiverId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        uploadedAt: true,
        evidence: { take: 1, orderBy: { linkedAt: 'asc' }, select: { instance: { select: { template: { select: { name: true } } } } } },
      },
    })
    return rows.map((row) => ({
      uploadedDocumentId: row.id,
      requirementName: row.evidence[0]?.instance.template.name ?? null,
      uploadedAt: row.uploadedAt,
    }))
  })
}

export function createUploadedDocument(
  agencyId: string,
  caregiverId: string,
  storageKey: string,
): Promise<StoredUploadedDocument> {
  return runInAuditedTransaction((tx) =>
    tx.uploadedDocument.create({
      data: { agencyId, caregiverId, storageKey },
      select: { id: true, storageKey: true },
    }),
  )
}
