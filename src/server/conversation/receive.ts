import 'server-only'
import { runInAuditedTransaction } from '@/db/audit'
import { toSsnCiphertext } from '@/db/mapping/sensitive'
import { appendMessage, ensureConversation, findLiveCaregiverByPhone } from '@/db/repositories/conversations'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { redactSsn } from '@/domain/conversation/redact'
import { checkUploadBytes } from '@/domain/documents/upload'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'

export const CONVERSATION_TURN_JOB_TYPE = 'conversation.turn'

const UNSUPPORTED_ATTACHMENT = '[unsupported attachment]'

type ReceiveResult = { ok: true } | { ok: false; reason: 'UNKNOWN_NUMBER' | 'EMPTY' }

/**
 * Stores one inbound text and queues its turn. An SSN in the text is sealed on the message and
 * replaced by a placeholder in the body, so neither the body nor the job payload carries it.
 */
export function receiveText(input: {
  agencyId: string
  from: string
  body: string
  media: Uint8Array | null
}): Promise<ReceiveResult> {
  return runAsSystem(async () => {
    const { agencyId, from, media } = input
    const { redacted, ssn } = redactSsn(input.body.trim())
    if (redacted === '' && media === null) return { ok: false, reason: 'EMPTY' }

    const caregiver = await findLiveCaregiverByPhone(agencyId, from)
    if (caregiver === null) return { ok: false, reason: 'UNKNOWN_NUMBER' }
    const { caregiverId } = caregiver

    let body = redacted
    let mediaStorageKey: string | null = null
    if (media !== null) {
      const check = checkUploadBytes(media)
      if (check.ok) {
        mediaStorageKey = await getPort('storage').write(
          { agencyId, caregiverId, kind: 'upload', extension: check.format },
          media,
        )
      } else {
        body = body === '' ? UNSUPPORTED_ATTACHMENT : `${body} ${UNSUPPORTED_ATTACHMENT}`
      }
    }

    await runInAuditedTransaction(async (tx) => {
      const conversation = await ensureConversation(tx, agencyId, caregiverId, from)
      const message = await appendMessage(tx, agencyId, {
        conversationId: conversation.id,
        direction: 'INBOUND',
        author: 'CAREGIVER',
        body,
        ssnEnc: toSsnCiphertext(ssn),
        mediaStorageKey,
      })
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: CONVERSATION_TURN_JOB_TYPE,
        payload: { messageId: message.id },
        idempotencyKey: buildIdempotencyKey(CONVERSATION_TURN_JOB_TYPE, [message.id]),
      })
    })
    return { ok: true }
  })
}
