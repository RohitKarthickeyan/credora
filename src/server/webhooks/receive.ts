import 'server-only'
import { findWebhookSubjectAgency, recordInboundWebhook } from '@/db/repositories/inbound-webhooks'
import { enqueueJob } from '@/db/repositories/jobs'
import type { BackgroundCheckPort } from '@/integrations/ports/backgroundCheck'
import type { EsignPort } from '@/integrations/ports/esign'
import type { WebhookDelivery, WebhookVerification } from '@/integrations/ports/webhook'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { BackgroundCheckWebhookJobPayload, EsignWebhookJobPayload } from './jobs'
import { WEBHOOK_JOB_TYPES } from './jobs'

export type WebhookTarget =
  | { readonly provider: 'esign'; readonly port: Pick<EsignPort, 'verifyWebhook'> }
  | {
      readonly provider: 'backgroundCheck'
      readonly port: Pick<BackgroundCheckPort, 'verifyWebhook'>
    }

type ReceiveWebhookOutcome =
  | {
      readonly status: 'accepted'
      readonly inboundWebhookId: string
      readonly jobId: string
      readonly duplicate: boolean
    }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'unmatched'; readonly externalId: string }

export async function webhookDeliveryFrom(request: Request): Promise<WebhookDelivery> {
  return { rawBody: await request.text(), headers: Object.fromEntries(request.headers) }
}

function verifiedExternalId(
  target: WebhookTarget,
  delivery: WebhookDelivery,
): WebhookVerification<string> {
  if (target.provider === 'esign') {
    const verification = target.port.verifyWebhook(delivery)
    return verification.valid
      ? { valid: true, event: verification.event.envelopeId }
      : verification
  }
  const verification = target.port.verifyWebhook(delivery)
  return verification.valid ? { valid: true, event: verification.event.orderId } : verification
}

/**
 * Verify → resolve agency → persist → enqueue (INTEGRATIONS.md § Webhooks, ADR-045). The
 * receipt and the job are two idempotent writes, not one transaction: if the process dies
 * between them the caller answers 5xx, the vendor redelivers, and the job is enqueued then.
 */
export async function receiveWebhook(
  target: WebhookTarget,
  delivery: WebhookDelivery,
): Promise<ReceiveWebhookOutcome> {
  const verification = verifiedExternalId(target, delivery)
  if (!verification.valid) return { status: 'rejected', reason: verification.reason }

  const externalId = verification.event
  const agencyId = await findWebhookSubjectAgency(target.provider, externalId)
  if (agencyId === null) return { status: 'unmatched', externalId }

  const receipt = await recordInboundWebhook(agencyId, {
    provider: target.provider,
    externalId,
    rawBody: delivery.rawBody,
  })

  const type = WEBHOOK_JOB_TYPES[target.provider]
  const payload: EsignWebhookJobPayload | BackgroundCheckWebhookJobPayload =
    target.provider === 'esign'
      ? { inboundWebhookId: receipt.id, envelopeId: externalId }
      : { inboundWebhookId: receipt.id, orderId: externalId }

  const job = await enqueueJob({
    agencyId,
    type,
    payload,
    idempotencyKey: buildIdempotencyKey(type, [receipt.id]),
  })

  return {
    status: 'accepted',
    inboundWebhookId: receipt.id,
    jobId: job.jobId,
    duplicate: !receipt.created,
  }
}
