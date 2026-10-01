import 'server-only'
import { randomUUID } from 'node:crypto'
import { runInAuditedTransaction } from '@/db/audit'
import type { MessageRow } from '@/db/repositories/conversations'
import {
  findConversation,
  listMessages,
  lockConversation,
  updateConversation,
} from '@/db/repositories/conversations'
import { redactSsn } from '@/domain/conversation/redact'
import { MAX_UNCLEAR_REPLIES } from '@/domain/conversation/step'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { enqueueNudge } from './nudge-job'
import { sendAgentText } from './send'

const TRANSCRIPT_LIMIT = 200

export const viewConversation: UseCase<
  { readonly caregiverId: string },
  {
    readonly conversationId: string
    readonly paused: boolean
    readonly handedOff: boolean
    readonly needsReply: boolean
    readonly messages: readonly MessageRow[]
  } | null
> = defineUseCase('conversation.manage', async ({ principal, input }) => {
  const conversation = await findConversation(principal.agencyId, input.caregiverId)
  if (conversation === null) return null
  return {
    conversationId: conversation.id,
    paused: conversation.pausedAt !== null,
    handedOff: conversation.unclearCount >= MAX_UNCLEAR_REPLIES,
    needsReply: conversation.needsReplyAt !== null,
    messages: await listMessages(principal.agencyId, conversation.id, TRANSCRIPT_LIMIT),
  }
})

export const setConversationPaused: UseCase<
  { readonly caregiverId: string; readonly paused: boolean },
  void
> = defineUseCase('conversation.manage', ({ principal, input }) =>
  runInAuditedTransaction(async (tx) => {
    const { agencyId } = principal
    const conversation = await lockConversation(tx, agencyId, input.caregiverId)
    if (conversation === null) return
    if (input.paused) {
      await updateConversation(tx, agencyId, conversation.id, { pausedAt: new Date() })
      return
    }
    await updateConversation(tx, agencyId, conversation.id, { pausedAt: null, unclearCount: 0, awaitingStep: null })
    await enqueueNudge(tx, agencyId, input.caregiverId, null, `resume:${randomUUID()}`)
  }),
)

export const sendStaffText: UseCase<
  { readonly caregiverId: string; readonly body: string; readonly idempotencyKey: string },
  { readonly ok: true } | { readonly ok: false; readonly reason: 'CONTAINS_SSN' }
> = defineUseCase('conversation.manage', async ({ principal, input }) => {
  const { agencyId } = principal
  const body = input.body.trim()
  if (redactSsn(body).ssn !== null) return { ok: false, reason: 'CONTAINS_SSN' }
  const conversation = await findConversation(agencyId, input.caregiverId)
  if (conversation === null || body === '') return { ok: true }
  await sendAgentText({
    agencyId,
    caregiverId: input.caregiverId,
    conversationId: conversation.id,
    phone: conversation.phone,
    body,
    author: 'STAFF',
    idempotencyKey: input.idempotencyKey,
  })
  await runInAuditedTransaction((tx) => updateConversation(tx, agencyId, conversation.id, { needsReplyAt: null }))
  return { ok: true }
})
