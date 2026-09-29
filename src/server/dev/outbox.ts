import { listOutboxMessages } from '@/db/repositories/sent-messages'

const OUTBOX_LIMIT = 200

export function devOutbox() {
  return listOutboxMessages(OUTBOX_LIMIT)
}
