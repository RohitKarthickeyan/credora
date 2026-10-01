import 'server-only'
import { z } from 'zod'
import { type AuditedTx, runInAuditedTransaction } from '@/db/audit'
import { findConversationSnapshot } from '@/db/repositories/conversation-snapshot'
import { ensureConversation, findMobilePhone, updateConversation } from '@/db/repositories/conversations'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { type ConversationNotice, noticeFor, promptFor } from '@/domain/conversation/replies'
import { DEMO_DOCUMENTS, nextStep, stepKey } from '@/domain/conversation/step'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { runAsSystem } from '@/server/auth/context'
import { CONVERSATION_NUDGE_JOB_TYPE } from './nudge-type'
import { sendAgentText } from './send'

function parseNotice(value: string): ConversationNotice | undefined {
  if (value === 'WELCOME') return { kind: 'WELCOME' }
  if (value === 'SIGNED') return { kind: 'SIGNED' }
  const document = DEMO_DOCUMENTS.find((candidate) => value === `APPROVED:${candidate}`)
  return document === undefined ? undefined : { kind: 'APPROVED', document }
}

const LINK_READY_KEY = 'AWAIT_SIGNATURE:LINK'

export async function enqueueNudge(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  notice: string | null,
  cause: string,
): Promise<void> {
  await enqueueJobInTransaction(tx, {
    agencyId,
    type: CONVERSATION_NUDGE_JOB_TYPE,
    payload: { caregiverId, notice },
    idempotencyKey: buildIdempotencyKey(CONVERSATION_NUDGE_JOB_TYPE, [caregiverId, cause]),
  })
}

/**
 * A text the caregiver did not ask for: a notice of something that happened (invite, signature,
 * approval) and the prompt for wherever they now are. Skipped when there is nothing new to say.
 */
export const conversationNudgeJob = defineJobHandler({
  type: CONVERSATION_NUDGE_JOB_TYPE,
  schema: z.object({ caregiverId: z.uuid(), notice: z.string().nullable() }),
  run: ({ caregiverId, notice: raw }, { agencyId, jobId }) =>
    runAsSystem(async () => {
      const notice = raw === null ? null : parseNotice(raw)
      if (notice === undefined) return { status: 'fail', reason: `Unknown conversation notice "${raw}".` }
      const phone = await runInAuditedTransaction((tx) => findMobilePhone(tx, agencyId, caregiverId))
      if (phone === null) return { status: 'ok' }
      const conversation = await runInAuditedTransaction((tx) => ensureConversation(tx, agencyId, caregiverId, phone))
      const view = await findConversationSnapshot(agencyId, caregiverId)
      if (view === null) return { status: 'ok' }

      const step = nextStep(view.snapshot)
      if (step.kind === 'STOPPED' || step.kind === 'HANDED_OFF') return { status: 'ok' }
      // The link arrives after the step is first reached, so a step with a link is a new state to tell about.
      const key = step.kind === 'AWAIT_SIGNATURE' && view.context.signingUrl !== null ? LINK_READY_KEY : stepKey(step)
      if (notice === null && key === conversation.awaitingStep) return { status: 'ok' }

      const parts = [notice === null ? null : noticeFor(notice, view.context), promptFor(step, view.context)]
      await sendAgentText({
        agencyId,
        caregiverId,
        conversationId: conversation.id,
        phone,
        body: parts.filter((part) => part !== null).join('\n\n'),
        author: 'AGENT',
        idempotencyKey: buildIdempotencyKey(CONVERSATION_NUDGE_JOB_TYPE, [jobId]),
      })
      await runInAuditedTransaction((tx) => updateConversation(tx, agencyId, conversation.id, { awaitingStep: key }))
      return { status: 'ok' }
    }),
})
