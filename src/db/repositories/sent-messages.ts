import type { SentMessageModel } from '../generated/models/SentMessage'
import { prisma } from '../prisma'
import { isIdempotencyKeyConflict } from './jobs'

export type RecordSentMessageInput = {
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly idempotencyKey: string
  readonly providerMessageId: string
}

const IDEMPOTENCY_KEY_CONSTRAINT = 'SentMessage_agencyId_idempotencyKey_key'

/** The first write for a key wins; a repeat returns that row unchanged, as a vendor would. */
export async function recordSentMessage(
  agencyId: string,
  input: RecordSentMessageInput,
): Promise<SentMessageModel> {
  try {
    return await prisma.sentMessage.create({ data: { agencyId, ...input } })
  } catch (error) {
    if (!isIdempotencyKeyConflict(error, IDEMPOTENCY_KEY_CONSTRAINT)) throw error

    return prisma.sentMessage.findUniqueOrThrow({
      where: { agencyId_idempotencyKey: { agencyId, idempotencyKey: input.idempotencyKey } },
    })
  }
}

/** Dev outbox only — the declared unscoped read (ADR-043, T-051). Newest first. */
export function listOutboxMessages(limit: number): Promise<SentMessageModel[]> {
  return prisma.sentMessage.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  })
}
