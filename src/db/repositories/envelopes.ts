import type { EnvelopeStatus } from '@/domain/documents/envelope'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { StorageKey } from '@/integrations/ports/storage'
import type { AuditedTx } from '../audit'
import { prisma } from '../prisma'

type Signer = { readonly fullName: string; readonly email: string }

export type StoredEnvelope = {
  readonly id: string
  readonly status: EnvelopeStatus
  readonly signingUrl: string | null
  readonly documents: readonly { readonly documentKey: string; readonly name: string }[]
}

export type SendContext = {
  readonly stage: PipelineStage
  readonly workState: string | null
  readonly serviceType: string | null
  readonly payer: string | null
  readonly signer: Signer | null
  readonly latestEnvelope: StoredEnvelope | null
}

/** `GeneratedDocument` from src/server/forms is structurally this; db may not import server. */
export type PreparedEnvelopeDocument = {
  readonly documentKey: string
  readonly templateVersion: string
  readonly name: string
  readonly unsignedPdfKey: StorageKey
}

const SIGNER_SELECT = {
  identity: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
  contact: { select: { email: true } },
} as const

type SignerRow = {
  readonly identity: {
    readonly legalFirstName: string | null
    readonly legalMiddleName: string | null
    readonly legalLastName: string | null
  } | null
  readonly contact: { readonly email: string | null } | null
}

// The e-sign port needs a full name and an email; the email need not be verified.
function signerFrom(row: SignerRow): Signer | null {
  const first = row.identity?.legalFirstName ?? null
  const last = row.identity?.legalLastName ?? null
  const email = row.contact?.email ?? null
  if (first === null || last === null || email === null) return null

  const fullName = [first, row.identity?.legalMiddleName ?? null, last]
    .filter((part) => part !== null)
    .join(' ')
  return { fullName, email }
}

const DOCUMENTS_IN_ORDER = {
  select: { documentKey: true, name: true },
  orderBy: { id: 'asc' },
} as const

export async function findSendContext(
  agencyId: string,
  caregiverId: string,
): Promise<SendContext | null> {
  const row = await prisma.caregiver.findFirst({
    where: { id: caregiverId, agencyId },
    select: {
      stage: true,
      workState: true,
      serviceType: true,
      payer: true,
      ...SIGNER_SELECT,
      envelopes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, signingUrl: true, documents: DOCUMENTS_IN_ORDER },
      },
    },
  })
  if (row === null) return null

  return {
    stage: row.stage,
    workState: row.workState,
    serviceType: row.serviceType,
    payer: row.payer,
    signer: signerFrom(row),
    latestEnvelope: row.envelopes[0] ?? null,
  }
}

export async function recordPreparedEnvelope(
  tx: AuditedTx,
  agencyId: string,
  input: { readonly caregiverId: string; readonly documents: readonly PreparedEnvelopeDocument[] },
): Promise<{ readonly envelopeId: string }> {
  const envelope = await tx.envelope.create({
    data: { agencyId, caregiverId: input.caregiverId },
    select: { id: true },
  })
  // One insert per row, in generated order: uuid(7) ids are time-ordered, so id order is the
  // order the documents are presented in.
  for (const document of input.documents) {
    await tx.envelopeDocument.create({
      data: {
        agencyId,
        envelopeId: envelope.id,
        documentKey: document.documentKey,
        templateVersion: document.templateVersion,
        name: document.name,
        unsignedPdfKey: document.unsignedPdfKey,
      },
    })
  }
  return { envelopeId: envelope.id }
}

export async function findEnvelopeForSend(
  tx: AuditedTx,
  agencyId: string,
  envelopeId: string,
): Promise<{
  readonly caregiverId: string
  readonly status: EnvelopeStatus
  readonly signer: Signer | null
  readonly documents: readonly {
    readonly documentKey: string
    readonly name: string
    readonly unsignedPdfKey: StorageKey
  }[]
} | null> {
  const row = await tx.envelope.findFirst({
    where: { id: envelopeId, agencyId },
    select: {
      caregiverId: true,
      status: true,
      caregiver: { select: SIGNER_SELECT },
      documents: {
        select: { documentKey: true, name: true, unsignedPdfKey: true },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (row === null) return null

  return {
    caregiverId: row.caregiverId,
    status: row.status,
    signer: signerFrom(row.caregiver),
    documents: row.documents,
  }
}

// OPEN-QUESTIONS 124: the URL returned at create is stored; a real vendor's embedded URL is short-lived.
export async function recordEnvelopeSent(
  tx: AuditedTx,
  agencyId: string,
  envelopeId: string,
  input: { readonly vendorEnvelopeId: string; readonly signingUrl: string | null },
): Promise<boolean> {
  const { count } = await tx.envelope.updateMany({
    where: { id: envelopeId, agencyId, status: 'PREPARING' },
    data: { status: 'SENT', vendorEnvelopeId: input.vendorEnvelopeId, signingUrl: input.signingUrl },
  })
  return count === 1
}

export async function findEnvelopeByVendorId(
  tx: AuditedTx,
  agencyId: string,
  vendorEnvelopeId: string,
): Promise<{
  readonly id: string
  readonly caregiverId: string
  readonly status: EnvelopeStatus
  readonly documents: readonly { readonly documentKey: string; readonly templateVersion: string }[]
} | null> {
  return tx.envelope.findUnique({
    where: { agencyId_vendorEnvelopeId: { agencyId, vendorEnvelopeId } },
    select: {
      id: true,
      caregiverId: true,
      status: true,
      documents: { select: { documentKey: true, templateVersion: true }, orderBy: { id: 'asc' } },
    },
  })
}

/** Guarded on SENT, so a redelivered outcome finds nothing to update and reports `false`. */
export async function closeEnvelope(
  tx: AuditedTx,
  agencyId: string,
  vendorEnvelopeId: string,
  outcome:
    | { readonly status: 'SIGNED'; readonly signedAt: Date }
    | { readonly status: 'DECLINED' | 'VOIDED' },
): Promise<boolean> {
  const { count } = await tx.envelope.updateMany({
    where: { agencyId, vendorEnvelopeId, status: 'SENT' },
    data: outcome,
  })
  return count === 1
}

export async function findSentEnvelope(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<{ readonly vendorEnvelopeId: string } | null> {
  const row = await tx.envelope.findFirst({
    where: { agencyId, caregiverId, status: 'SENT', vendorEnvelopeId: { not: null } },
    select: { vendorEnvelopeId: true },
  })
  if (row === null || row.vendorEnvelopeId === null) return null
  return { vendorEnvelopeId: row.vendorEnvelopeId }
}
