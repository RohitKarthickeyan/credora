import 'server-only'
import { runInAuditedTransaction } from '@/db/audit'
import { appendMessage } from '@/db/repositories/conversations'
import { getPort } from '@/integrations/registry'

export async function sendAgentText(input: {
  agencyId: string
  caregiverId: string
  conversationId: string
  phone: string
  body: string
  author: 'AGENT' | 'STAFF'
  idempotencyKey: string
}): Promise<void> {
  const { agencyId, phone, body, idempotencyKey } = input
  await getPort('messaging').sendText({ agencyId, to: phone, body, idempotencyKey })
  await runInAuditedTransaction((tx) =>
    appendMessage(tx, agencyId, {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      author: input.author,
      body,
    }),
  )
}
