import { z } from 'zod'

export const webhookProviderSchema = z.enum(['esign', 'backgroundCheck'])
export type WebhookProvider = z.infer<typeof webhookProviderSchema>

export const WEBHOOK_JOB_TYPES = {
  esign: 'webhook.esign',
  backgroundCheck: 'webhook.backgroundCheck',
} as const satisfies Record<WebhookProvider, string>

// Identifiers only, and deliberately not the event's status: the mocks' HMAC secrets are
// public, so a handler re-reads getEnvelope / getOrder rather than trusting the event.
export const esignWebhookJobPayloadSchema = z.object({
  inboundWebhookId: z.uuid(),
  envelopeId: z.string().min(1),
})
export type EsignWebhookJobPayload = z.infer<typeof esignWebhookJobPayloadSchema>

export const backgroundCheckWebhookJobPayloadSchema = z.object({
  inboundWebhookId: z.uuid(),
  orderId: z.string().min(1),
})
export type BackgroundCheckWebhookJobPayload = z.infer<
  typeof backgroundCheckWebhookJobPayloadSchema
>
