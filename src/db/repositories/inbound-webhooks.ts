import { createHash } from 'node:crypto'
import type { AuditedTx } from '../audit'
import type { InboundWebhookModel } from '../generated/models/InboundWebhook'
import { prisma } from '../prisma'
import { isIdempotencyKeyConflict } from './jobs'

type WebhookProvider = InboundWebhookModel['provider']

const RECEIPT_CONSTRAINT = 'InboundWebhook_agencyId_provider_bodySha256_key'

/**
 * Record which agency owns a vendor id, so its callbacks can be routed (ADR-044). It takes an
 * `AuditedTx` so the subject commits or rolls back with the caller's envelope or order row.
 * A repeat for the same agency is a no-op; an id already held by another agency throws rather
 * than misroute that agency's callbacks.
 */
export async function registerWebhookSubject(
  tx: AuditedTx,
  agencyId: string,
  input: { readonly provider: WebhookProvider; readonly externalId: string },
): Promise<void> {
  const subject = await tx.webhookSubject.upsert({
    where: { provider_externalId: { provider: input.provider, externalId: input.externalId } },
    create: { agencyId, provider: input.provider, externalId: input.externalId },
    update: {},
    select: { agencyId: true },
  })
  if (subject.agencyId !== agencyId) {
    throw new Error(`This ${input.provider} id is already registered to another agency.`)
  }
}

/** Webhook agency resolution only — the declared unscoped read (ADR-044, T-058). */
export async function findWebhookSubjectAgency(
  provider: WebhookProvider,
  externalId: string,
): Promise<string | null> {
  const subject = await prisma.webhookSubject.findUnique({
    where: { provider_externalId: { provider, externalId } },
    select: { agencyId: true },
  })
  return subject?.agencyId ?? null
}

/** Byte-identical deliveries are one receipt: a repeat returns the first row's id. */
export async function recordInboundWebhook(
  agencyId: string,
  input: {
    readonly provider: WebhookProvider
    readonly externalId: string
    readonly rawBody: string
  },
): Promise<{ readonly created: boolean; readonly id: string }> {
  const bodySha256 = createHash('sha256').update(input.rawBody).digest('hex')

  try {
    const receipt = await prisma.inboundWebhook.create({
      data: { agencyId, bodySha256, ...input },
      select: { id: true },
    })
    return { created: true, id: receipt.id }
  } catch (error) {
    if (!isIdempotencyKeyConflict(error, RECEIPT_CONSTRAINT)) throw error

    const existing = await prisma.inboundWebhook.findUniqueOrThrow({
      where: {
        agencyId_provider_bodySha256: { agencyId, provider: input.provider, bodySha256 },
      },
      select: { id: true },
    })
    return { created: false, id: existing.id }
  }
}
