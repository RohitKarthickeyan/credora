import type { EnvelopeStatus } from '@/domain/documents/envelope'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { AuditedTx } from '../audit'
import type { InboundWebhookModel } from '../generated/models/InboundWebhook'
import { prisma } from '../prisma'

type WebhookProvider = InboundWebhookModel['provider']

/**
 * Declared exception to DATA-MODEL invariant 5 (ADR-155): returns only ids. Single permitted
 * caller src/server/retention/schedule.ts.
 */
export async function listAgencyIds(): Promise<readonly string[]> {
  const rows = await prisma.agency.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  return rows.map((row) => row.id)
}

type NeverStartedCandidate = {
  readonly caregiverId: string
  readonly invitesCreatedAt: readonly Date[]
  readonly inviteTokens: readonly { readonly expiresAt: Date; readonly consumedAt: Date | null }[]
}

/**
 * Only caregivers no invite or INVITE token of which is anchored after the cutoff, so a batch is
 * never filled by applicants not yet due; neverStartedApplicantDue remains the rule.
 */
export async function listNeverStartedCandidates(
  agencyId: string,
  cutoff: Date,
  limit: number,
): Promise<readonly NeverStartedCandidate[]> {
  const rows = await prisma.caregiver.findMany({
    where: {
      agencyId,
      stage: 'INVITED',
      invites: { none: { createdAt: { gt: cutoff } } },
      linkTokens: { none: { purpose: 'INVITE', expiresAt: { gt: cutoff } } },
    },
    select: {
      id: true,
      invites: { select: { createdAt: true } },
      linkTokens: { where: { purpose: 'INVITE' }, select: { expiresAt: true, consumedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  return rows.map((row) => ({
    caregiverId: row.id,
    invitesCreatedAt: row.invites.map((invite) => invite.createdAt),
    inviteTokens: row.linkTokens,
  }))
}

type CaregiverForDeletion = {
  readonly stage: PipelineStage
  readonly hiredAt: Date | null
  readonly storageKeys: readonly string[]
  readonly referenceIds: readonly string[]
  readonly backgroundCheckOrderId: string | null
}

export async function findCaregiverForDeletion(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<CaregiverForDeletion | null> {
  const row = await tx.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: {
      stage: true,
      // OPEN-QUESTIONS 254: the hire is the first SYNC_COMPLETED event.
      pipelineEvents: {
        where: { event: 'SYNC_COMPLETED' },
        select: { occurredAt: true },
        orderBy: { occurredAt: 'asc' },
        take: 1,
      },
      uploadedDocuments: { select: { storageKey: true } },
      signedDocuments: { select: { signedPdfKey: true } },
      envelopes: {
        select: { documents: { where: { unsignedPdfDeletedAt: null }, select: { unsignedPdfKey: true } } },
      },
      references: { select: { id: true } },
      backgroundCheckOrder: { select: { id: true } },
    },
  })
  if (row === null) return null

  return {
    stage: row.stage,
    hiredAt: row.pipelineEvents[0]?.occurredAt ?? null,
    storageKeys: [
      ...row.uploadedDocuments.map((document) => document.storageKey),
      ...row.signedDocuments.map((document) => document.signedPdfKey),
      ...row.envelopes.flatMap((envelope) => envelope.documents.map((document) => document.unsignedPdfKey)),
    ],
    referenceIds: row.references.map((reference) => reference.id),
    backgroundCheckOrderId: row.backgroundCheckOrder?.id ?? null,
  }
}

/**
 * Guarded on stage INVITED, the race guard against a concurrent INTAKE_STARTED. The vendor ids
 * are read first because the cascade deletes the rows carrying them, and the webhook rows (no
 * FK reaches them) are deleted only once the caregiver was, so a refusal writes nothing.
 */
export async function deleteInvitedCaregiver(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<boolean> {
  const envelopes = await tx.envelope.findMany({
    where: { agencyId, caregiverId, vendorEnvelopeId: { not: null } },
    select: { vendorEnvelopeId: true },
  })
  const order = await tx.backgroundCheckOrder.findFirst({
    where: { agencyId, caregiverId },
    select: { vendorOrderId: true },
  })

  const { count } = await tx.caregiver.deleteMany({ where: { agencyId, id: caregiverId, stage: 'INVITED' } })
  if (count === 0) return false

  const envelopeIds = envelopes.flatMap((envelope) => envelope.vendorEnvelopeId ?? [])
  const orderIds = order?.vendorOrderId ? [order.vendorOrderId] : []
  const vendorIds = [
    { provider: 'esign' as const, externalId: { in: envelopeIds } },
    { provider: 'backgroundCheck' as const, externalId: { in: orderIds } },
  ]
  await tx.webhookSubject.deleteMany({ where: { agencyId, OR: vendorIds } })
  await tx.inboundWebhook.deleteMany({ where: { agencyId, OR: vendorIds } })
  return true
}

type DisposableUnsignedPdf = {
  readonly envelopeDocumentId: string
  readonly caregiverId: string
  readonly unsignedPdfKey: string
}

export async function listDisposableUnsignedPdfs(
  agencyId: string,
  statuses: readonly EnvelopeStatus[],
  limit: number,
): Promise<readonly DisposableUnsignedPdf[]> {
  const rows = await prisma.envelopeDocument.findMany({
    where: {
      agencyId,
      unsignedPdfDeletedAt: null,
      envelope: { OR: [{ status: { in: [...statuses] } }, { caregiver: { stage: 'WITHDRAWN' } }] },
    },
    select: { id: true, unsignedPdfKey: true, envelope: { select: { caregiverId: true } } },
    take: limit,
  })
  return rows.map((row) => ({
    envelopeDocumentId: row.id,
    caregiverId: row.envelope.caregiverId,
    unsignedPdfKey: row.unsignedPdfKey,
  }))
}

export async function markUnsignedPdfDeleted(
  tx: AuditedTx,
  agencyId: string,
  envelopeDocumentId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.envelopeDocument.updateMany({
    where: { agencyId, id: envelopeDocumentId, unsignedPdfDeletedAt: null },
    data: { unsignedPdfDeletedAt: at },
  })
  return count === 1
}

type ExpiredBackgroundCheckOrder = {
  readonly orderId: string
  readonly caregiverId: string
  readonly vendorOrderId: string | null
}

/** Anchored on the result, or on the request for an order that never resulted. */
export async function listBackgroundCheckOrdersBefore(
  agencyId: string,
  cutoff: Date,
  limit: number,
): Promise<readonly ExpiredBackgroundCheckOrder[]> {
  const rows = await prisma.backgroundCheckOrder.findMany({
    where: {
      agencyId,
      OR: [{ resultAt: { lt: cutoff } }, { resultAt: null, requestedAt: { lt: cutoff } }],
    },
    select: { id: true, caregiverId: true, vendorOrderId: true },
    take: limit,
  })
  return rows.map((row) => ({ orderId: row.id, caregiverId: row.caregiverId, vendorOrderId: row.vendorOrderId }))
}

export async function deleteBackgroundCheckOrder(
  tx: AuditedTx,
  agencyId: string,
  orderId: string,
  vendorOrderId: string | null,
): Promise<boolean> {
  const { count } = await tx.backgroundCheckOrder.deleteMany({ where: { agencyId, id: orderId } })
  if (count === 0) return false

  if (vendorOrderId !== null) {
    await tx.webhookSubject.deleteMany({ where: { agencyId, provider: 'backgroundCheck', externalId: vendorOrderId } })
  }
  return true
}

export async function deleteInboundWebhooksBefore(
  tx: AuditedTx,
  agencyId: string,
  provider: WebhookProvider,
  cutoff: Date,
): Promise<readonly string[]> {
  const rows = await tx.inboundWebhook.findMany({
    where: { agencyId, provider, receivedAt: { lt: cutoff } },
    select: { id: true },
  })
  const ids = rows.map((row) => row.id)
  await tx.inboundWebhook.deleteMany({ where: { agencyId, id: { in: ids } } })
  return ids
}

/**
 * ADR-156. Keeps every entry about a caregiver still on file (the I-9 audit-trail floor): CAREGIVER,
 * MEDICAL_FILE and EEOC_RECORD entries all carry the caregiver id. DDL is transactional, so a
 * rollback re-enables the trigger too, and ALTER TABLE's ACCESS EXCLUSIVE lock means no other
 * transaction can write to the table while the trigger is off.
 */
export async function deleteAuditEntriesBefore(tx: AuditedTx, agencyId: string, cutoff: Date): Promise<number> {
  await tx.$executeRaw`ALTER TABLE core."AuditEntry" DISABLE TRIGGER audit_entry_append_only`
  const deleted = await tx.$executeRaw`
    DELETE FROM core."AuditEntry" a
     WHERE a."agencyId" = ${agencyId} AND a."at" < ${cutoff}
       AND NOT EXISTS (SELECT 1 FROM core."Caregiver" c WHERE c."agencyId" = a."agencyId" AND c."id" = a."entityId")`
  await tx.$executeRaw`ALTER TABLE core."AuditEntry" ENABLE TRIGGER audit_entry_append_only`
  return deleted
}
