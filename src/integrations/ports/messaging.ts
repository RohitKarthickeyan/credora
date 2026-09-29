import { z } from 'zod'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

// Email only: Credora sends no text messages (ADR-161).
export const sendMessageInputSchema = z.object({
  agencyId: z.uuid(),
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1),
})
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>

export const sendMessageResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('sent'), providerMessageId: z.string().min(1) }),
  z.object({ status: z.literal('rejected'), reason: z.string().min(1) }),
])
type SendMessageResult = z.infer<typeof sendMessageResultSchema>

export interface MessagingPort {
  send(input: SendMessageInput): Promise<SendMessageResult>
}
