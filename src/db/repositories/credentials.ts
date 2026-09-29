import { z } from 'zod'
import { normaliseFields } from '@/domain/documents/extraction'
import type { CredentialSource, ProjectedCredential } from '@/domain/requirements/credential'
import type { CredentialType } from '@/domain/sync/alayacare-mapping'
import { extractedFieldSchema } from '@/integrations/ports/extraction'
import { runInAuditedTransaction } from '../audit'
import { fromDateColumn, toDateColumn } from '../mapping/date-only'

export type StoredCredential = {
  readonly id: string
  readonly type: CredentialType
  readonly number: string | null
  readonly issuer: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  // null only for a credential not written by projectCredentials (ADR-107).
  readonly uploadedDocumentId: string | null
  /** The evidence file's storage key; null with uploadedDocumentId. Its kind may be `clinical`. */
  readonly uploadedDocumentKey: string | null
}

// Extraction.fields only: a clinic result's text lives in the medical store (ADR-082).
export function findCredentialSources(agencyId: string, caregiverId: string): Promise<readonly CredentialSource[]> {
  return runInAuditedTransaction(async (tx) => {
    const instances = await tx.requirementInstance.findMany({
      where: { agencyId, caregiverId },
      orderBy: { templateKey: 'asc' },
      select: {
        id: true,
        status: true,
        template: { select: { validityRule: true, validityMonths: true } },
        evidence: {
          where: { kind: 'UPLOADED_DOCUMENT' },
          select: {
            evidenceKey: true,
            uploadedDocument: {
              select: {
                id: true,
                uploadedAt: true,
                extraction: { select: { fields: true } },
                autoAcceptDecision: { select: { instanceStatusSet: true } },
                staffDecision: { select: { decision: true } },
              },
            },
          },
        },
      },
    })

    return instances.map((instance) => ({
      instanceId: instance.id,
      status: instance.status,
      validity: instance.template,
      documents: instance.evidence
        .flatMap(({ evidenceKey, uploadedDocument }) => (uploadedDocument === null ? [] : [{ evidenceKey, ...uploadedDocument }]))
        .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime() || a.id.localeCompare(b.id))
        .map((document) => ({
          uploadedDocumentId: document.id,
          evidenceKey: document.evidenceKey,
          satisfiedInstance:
            document.autoAcceptDecision?.instanceStatusSet === 'SATISFIED' || document.staffDecision?.decision === 'ACCEPTED',
          fields:
            document.extraction === null
              ? {}
              : normaliseFields(
                  z
                    .array(extractedFieldSchema)
                    .parse(document.extraction.fields)
                    .map(({ name, value, confidence }) => ({ name, asPrinted: value, confidence })),
                ),
        })),
    }))
  })
}

// Upsert, not replace, so a credential's id is stable for the sync's idempotency keys.
export function upsertCredentials(
  agencyId: string,
  caregiverId: string,
  credentials: readonly ProjectedCredential[],
  verifiedAt: Date,
): Promise<void> {
  return runInAuditedTransaction(async (tx) => {
    for (const { instanceId, uploadedDocumentId, type, number, issuer, issuedOn, expiresOn } of credentials) {
      const values = {
        uploadedDocumentId,
        type,
        number,
        issuer,
        issuedOn: toDateColumn(issuedOn),
        expiresAt: toDateColumn(expiresOn),
        verificationStatus: 'VERIFIED',
        verifiedAt,
      } as const
      await tx.credential.upsert({
        where: { agencyId_instanceId: { agencyId, instanceId } },
        create: { agencyId, caregiverId, instanceId, ...values },
        update: values,
      })
    }
  })
}

export function findCaregiverCredentials(agencyId: string, caregiverId: string): Promise<readonly StoredCredential[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.credential.findMany({
      where: { agencyId, caregiverId },
      include: { uploadedDocument: { select: { storageKey: true } } },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      number: row.number,
      issuer: row.issuer,
      issuedOn: fromDateColumn(row.issuedOn),
      expiresOn: fromDateColumn(row.expiresAt),
      uploadedDocumentId: row.uploadedDocumentId,
      uploadedDocumentKey: row.uploadedDocument?.storageKey ?? null,
    }))
  })
}
