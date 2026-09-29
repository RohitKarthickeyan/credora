import { z } from 'zod'
import type { WebhookDelivery, WebhookVerification } from './webhook'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

export const backgroundCheckStatusSchema = z.enum(['ORDERED', 'PENDING', 'CLEAR', 'CONSIDER'])
export type BackgroundCheckStatus = z.infer<typeof backgroundCheckStatusSchema>

// packageCode is the agency's own vendor package code, deliberately not an enum: DOMAIN.md's only
// NY check (CHRC) never crosses this port (ADR-032). No SSN crosses this port; widening
// `subject` needs an ADR.
export const orderBackgroundCheckInputSchema = z.object({
  agencyId: z.uuid(),
  caregiverId: z.uuid(),
  packageCode: z.string().min(1),
  subject: z.object({
    fullName: z.string().min(1),
    dateOfBirth: z.iso.date(),
  }),
  idempotencyKey: z.string().min(1),
})
type OrderBackgroundCheckInput = z.infer<typeof orderBackgroundCheckInputSchema>

export const backgroundCheckOrderSchema = z.object({
  orderId: z.string().min(1),
  status: backgroundCheckStatusSchema,
})
export type BackgroundCheckOrder = z.infer<typeof backgroundCheckOrderSchema>

export const backgroundCheckEventSchema = z.object({
  orderId: z.string().min(1),
  status: backgroundCheckStatusSchema,
  occurredAt: z.iso.datetime(),
})
export type BackgroundCheckEvent = z.infer<typeof backgroundCheckEventSchema>

export interface BackgroundCheckPort {
  order(input: OrderBackgroundCheckInput): Promise<BackgroundCheckOrder>
  getOrder(agencyId: string, orderId: string): Promise<BackgroundCheckOrder | null>
  verifyWebhook(delivery: WebhookDelivery): WebhookVerification<BackgroundCheckEvent>
}
