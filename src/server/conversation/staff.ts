import 'server-only'
import { randomUUID } from 'node:crypto'
import { runInAuditedTransaction } from '@/db/audit'
import type { MessageRow } from '@/db/repositories/conversations'
import {
  findConversation,
  listConversations,
  listMessages,
  lockConversation,
  updateConversation,
} from '@/db/repositories/conversations'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import type { PipelineStage } from '@/domain/pipeline/stage'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { sendAgentText } from './send'
import { CONVERSATION_NUDGE_JOB_TYPE } from './nudge-type'

const TRANSCRIPT_LIMIT = 200
const HANDOFF_UNCLEAR_COUNT = 3

export type ConversationSummary = {
  readonly caregiverId: string
  readonly caregiverName: string
  readonly stage: PipelineStage
  readonly lastMessage: string
  readonly lastMessageAt: Date
  readonly paused: boolean
  readonly handedOff: boolean
}

export const viewConversation: UseCase<
  { readonly caregiverId: string },
  {
    readonly conversationId: string
    readonly paused: boolean
    readonly handedOff: boolean
    readonly messages: readonly MessageRow[]
  } | null
> = defineUseCase('conversation.manage', async ({ principal, input }) => {
  const conversation = await findConversation(principal.agencyId, input.caregiverId)
  if (conversation === null) return null
  return {
    conversationId: conversation.id,
    paused: conversation.pausedAt !== null,
    handedOff: conversation.unclearCount >= HANDOFF_UNCLEAR_COUNT,
    messages: await listMessages(principal.agencyId, conversation.id, TRANSCRIPT_LIMIT),
  }
})

export const listConversationsForStaff: UseCase<Record<string, never>, readonly ConversationSummary[]> =
  defineUseCase('conversation.manage', async ({ principal }) => {
    const rows = await listConversations(principal.agencyId)
    return rows.map(({ unclearCount, pausedAt, ...row }) => ({
      ...row,
      paused: pausedAt !== null,
      handedOff: unclearCount >= HANDOFF_UNCLEAR_COUNT,
    }))
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
    await updateConversation(tx, agencyId, conversation.id, { pausedAt: null, unclearCount: 0 })
    await enqueueJobInTransaction(tx, {
      agencyId,
      type: CONVERSATION_NUDGE_JOB_TYPE,
      payload: { caregiverId: input.caregiverId, notice: null },
      idempotencyKey: buildIdempotencyKey(CONVERSATION_NUDGE_JOB_TYPE, [conversation.id, randomUUID()]),
    })
  }),
)

export const sendStaffText: UseCase<
  { readonly caregiverId: string; readonly body: string; readonly idempotencyKey: string },
  void
> = defineUseCase('conversation.manage', async ({ principal, input }) => {
    const body = input.body.trim()
    const conversation = await findConversation(principal.agencyId, input.caregiverId)
    if (conversation === null || body === '') return
    await sendAgentText({
      agencyId: principal.agencyId,
      caregiverId: input.caregiverId,
      conversationId: conversation.id,
      phone: conversation.phone,
      body,
      author: 'STAFF',
      idempotencyKey: input.idempotencyKey,
    })
  })
