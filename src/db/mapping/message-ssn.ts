import { decryptField } from '@/db/crypto'
import type { AuditedTx } from '../audit'

/**
 * The SSN a caregiver texted, opened only to be written to their own SSN column
 * (saveTextIntakeField). Scoped to the caregiver's conversation, so one caregiver's message
 * never fills another's record.
 */
export async function readMessageSsn(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  messageId: string,
): Promise<string | null> {
  const row = await tx.message.findFirst({
    where: { agencyId, id: messageId, conversation: { caregiverId } },
    select: { ssnEnc: true },
  })
  return decryptField(row?.ssnEnc ?? null)
}
