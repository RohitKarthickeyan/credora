import { recordSentMessage } from '@/db/repositories/sent-messages'
import { sendMessageInputSchema } from '@/integrations/ports/messaging'
import type { MessagingPort } from '@/integrations/ports/messaging'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { REJECTED_RECIPIENTS } from './fixtures/recipients'

// Sends nothing: records what would have been sent so /dev/outbox can show it (ADR-042, T-051).
export function createMockMessaging(): MessagingPort {
  return {
    async send(input) {
      const parsed = sendMessageInputSchema.parse(input)

      const reason = REJECTED_RECIPIENTS[parsed.to]
      if (reason !== undefined) return { status: 'rejected', reason }

      const row = await recordSentMessage(parsed.agencyId, {
        to: parsed.to,
        subject: parsed.subject,
        body: parsed.body,
        idempotencyKey: parsed.idempotencyKey,
        providerMessageId: buildIdempotencyKey('messaging.mock', [
          parsed.agencyId,
          parsed.idempotencyKey,
        ]),
      })
      return { status: 'sent', providerMessageId: row.providerMessageId }
    },
  }
}
