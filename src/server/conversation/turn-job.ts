import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { type ConversationSnapshotView, findConversationSnapshot } from '@/db/repositories/conversation-snapshot'
import {
  type ConversationMessage as Message,
  type ConversationRow,
  findConversation,
  findMessage,
  hasEarlierUnfinishedTurn,
  listMessages,
  updateConversation,
} from '@/db/repositories/conversations'
import { caregiverPrincipalFrom } from '@/domain/auth/caregiver-principal'
import { type AgentEvent, eventKindsFor } from '@/domain/conversation/events'
import { passesOutputCheck } from '@/domain/conversation/output-check'
import { SSN_PLACEHOLDER } from '@/domain/conversation/redact'
import { FAILURE_REPLY, HANDOFF_REPLY, WRONG_TIME_FOR_PHOTO, promptFor } from '@/domain/conversation/replies'
import { statusLine } from '@/domain/conversation/status-line'
import { type ConversationStep, nextStep, stepKey } from '@/domain/conversation/step'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { runAsPrincipal, runAsSystem } from '@/server/auth/context'
import { uploadOwnDocument } from '@/server/documents/uploads'
import { confirmTextIntake, saveTextIntakeField } from '@/server/intake/text-intake'
import { CONVERSATION_TURN_JOB_TYPE, CONVERSATION_TURN_MAX_ATTEMPTS } from './receive'
import { sendAgentText } from './send'

const OK = { status: 'ok' } as const
const HISTORY_LENGTH = 8
const UNCLEAR_PREFIX = "Sorry, I didn't catch that. "
const PHOTO_RECEIVED = "Got it, I'm checking it now."
const OPTED_OUT_REPLY = "You won't get more texts from us. Reply START to resume."

type Applied =
  | { readonly kind: 'saved' }
  | { readonly kind: 'unclear' }
  | { readonly kind: 'handoff' }
  | { readonly kind: 'answered'; readonly answer: string; readonly needsReply: boolean }

const SAVED: Applied = { kind: 'saved' }
const UNCLEAR: Applied = { kind: 'unclear' }

// Steps that ask the caregiver for nothing: a text the agent cannot place there ("ok", "thanks!")
// is an acknowledgement, so it gets no reply and does not count toward a handoff.
const NO_INPUT_STEPS: ReadonlySet<ConversationStep['kind']> = new Set(['AWAIT_SIGNATURE', 'AWAIT_REVIEW', 'CLEARED'])

function allowedOrigins(): string[] {
  return [env.APP_URL, env.DOCUSEAL_URL].filter((origin) => origin !== undefined)
}

async function asCaregiver<T>(agencyId: string, caregiverId: string, fn: () => Promise<T>): Promise<T> {
  const row = await findCaregiverForSession(agencyId, caregiverId)
  const principal = row === null ? null : caregiverPrincipalFrom(row)
  if (principal === null) throw new Error(`Caregiver ${caregiverId} cannot act: not found or withdrawn.`)
  return runAsPrincipal(principal, {}, fn)
}

async function interpret(
  agencyId: string,
  message: Message,
  step: ConversationStep,
  status: string,
  prompt: string,
): Promise<AgentEvent> {
  if (step.kind === 'ASK_FIELD' && step.field === 'ssn' && message.hasSsn) {
    return { kind: 'answer', value: SSN_PLACEHOLDER }
  }
  const recent = await listMessages(agencyId, message.conversationId, HISTORY_LENGTH + 1)
  const history = recent
    .filter(({ id }) => id !== message.id)
    .slice(-HISTORY_LENGTH)
    .map(({ direction, body }) => ({
      from: direction === 'INBOUND' ? ('caregiver' as const) : ('agent' as const),
      text: body,
    }))
  return getPort('agent').interpret({
    step: prompt,
    allowedEvents: [...eventKindsFor(step)],
    status,
    history,
    text: message.body,
  })
}

// The SSN is only ever taken from the message's own sealed copy, never from the model's words.
async function apply(event: AgentEvent, step: ConversationStep, message: Message): Promise<Applied> {
  const { caregiverId } = message
  switch (event.kind) {
    case 'answer': {
      if (step.kind !== 'ASK_FIELD') return UNCLEAR
      const saved = await saveTextIntakeField({
        caregiverId,
        field: step.field,
        value: event.value,
        ssnMessageId: message.id,
      })
      return saved.ok ? SAVED : UNCLEAR
    }
    case 'correct': {
      const saved = await saveTextIntakeField({
        caregiverId,
        field: event.field,
        value: event.value,
        ssnMessageId: message.id,
      })
      return saved.ok ? SAVED : UNCLEAR
    }
    case 'confirm': {
      const sent = await confirmTextIntake({ caregiverId, storage: getPort('storage') })
      return sent.ok ? SAVED : { kind: 'handoff' }
    }
    case 'question': {
      const { answer } = event
      return answer !== null && passesOutputCheck(answer, allowedOrigins())
        ? { kind: 'answered', answer, needsReply: false }
        : { kind: 'answered', answer: HANDOFF_REPLY, needsReply: true }
    }
    case 'unclear':
      return UNCLEAR
  }
}

async function receivePhoto(
  agencyId: string,
  message: Message,
  storageKey: string,
  step: ConversationStep,
  view: ConversationSnapshotView,
): Promise<string> {
  if (step.kind !== 'REQUEST_DOCUMENT' && step.kind !== 'FIX_DOCUMENT') return WRONG_TIME_FOR_PHOTO
  const { caregiverId } = message
  const storage = getPort('storage')
  const stored = await storage.read(agencyId, storageKey)
  const { instanceId, evidenceKey } = view.documentInstances[step.document]
  const uploaded =
    stored !== null &&
    (await asCaregiver(agencyId, caregiverId, () =>
      uploadOwnDocument({ caregiverId, instanceId, evidenceKey, bytes: stored.bytes, storage }),
    )).ok
  if (!uploaded) return promptFor(step, view.context)

  // The check's nudge texts what comes next (the next request, or the fix), so whatever step it
  // reaches, even this same one returned again, must read as new.
  await runInAuditedTransaction((tx) =>
    updateConversation(tx, agencyId, message.conversationId, { awaitingStep: null, unclearCount: 0 }),
  )
  return PHOTO_RECEIVED
}

async function takeTurn(
  agencyId: string,
  message: Message,
  conversation: ConversationRow,
  step: ConversationStep,
  status: string,
  prompt: string,
  attempt: number,
): Promise<string | null> {
  const { caregiverId, conversationId } = message
  let event: AgentEvent
  try {
    event = await interpret(agencyId, message, step, status, prompt)
  } catch (error) {
    if (attempt < CONVERSATION_TURN_MAX_ATTEMPTS) throw error
    await runInAuditedTransaction((tx) =>
      updateConversation(tx, agencyId, conversationId, { pausedAt: new Date() }),
    )
    return FAILURE_REPLY
  }

  const applied = await asCaregiver(agencyId, caregiverId, () => apply(event, step, message))
  if (applied.kind === 'unclear' && NO_INPUT_STEPS.has(step.kind)) return null
  const unclearCount = applied.kind === 'unclear' ? conversation.unclearCount + 1 : 0
  const handedOff = applied.kind === 'handoff'
  const fresh = await findConversationSnapshot(agencyId, caregiverId)
  if (fresh === null) return null
  const next = nextStep({ ...fresh.snapshot, unclearCount, paused: fresh.snapshot.paused || handedOff })
  await runInAuditedTransaction((tx) =>
    updateConversation(tx, agencyId, conversationId, {
      awaitingStep: stepKey(next),
      unclearCount,
      ...(handedOff ? { pausedAt: new Date() } : {}),
      ...(applied.kind === 'answered' && applied.needsReply ? { needsReplyAt: new Date() } : {}),
    }),
  )

  if (applied.kind === 'answered') {
    return next.kind === 'HANDED_OFF' || next.kind === 'STOPPED'
      ? applied.answer
      : `${applied.answer}\n\n${promptFor(next, fresh.context)}`
  }
  if (next.kind === 'HANDED_OFF') return HANDOFF_REPLY
  const nextPrompt = promptFor(next, fresh.context)
  return applied.kind === 'unclear' ? `${UNCLEAR_PREFIX}${nextPrompt}` : nextPrompt
}

async function replyTo(
  agencyId: string,
  message: Message,
  conversation: ConversationRow,
  view: ConversationSnapshotView,
  attempt: number,
): Promise<string | null> {
  const { conversationId } = message
  const command = message.body.trim().toUpperCase()
  if (command === 'STOP') {
    await runInAuditedTransaction((tx) =>
      updateConversation(tx, agencyId, conversationId, { optedOutAt: new Date() }),
    )
    return OPTED_OUT_REPLY
  }
  if (command === 'HELP') {
    await runInAuditedTransaction((tx) =>
      updateConversation(tx, agencyId, conversationId, { needsReplyAt: new Date() }),
    )
    return HANDOFF_REPLY
  }
  if (command === 'START' && view.snapshot.optedOut) {
    await runInAuditedTransaction((tx) => updateConversation(tx, agencyId, conversationId, { optedOutAt: null }))
    return promptFor(nextStep({ ...view.snapshot, optedOut: false }), view.context)
  }

  const step = nextStep(view.snapshot)
  if (step.kind === 'STOPPED' || step.kind === 'HANDED_OFF') return null
  if (message.mediaStorageKey !== null) {
    return receivePhoto(agencyId, message, message.mediaStorageKey, step, view)
  }
  const status = statusLine(view.snapshot)
  return takeTurn(agencyId, message, conversation, step, status, promptFor(step, view.context), attempt)
}

/**
 * One inbound text: derive the step, let the agent read the text into an event, apply it as the
 * caregiver, and reply from the fixed templates. The model's own words reach the caregiver only
 * as a checked answer to a question.
 */
export const conversationTurnJob = defineJobHandler({
  type: CONVERSATION_TURN_JOB_TYPE,
  schema: z.object({ messageId: z.uuid() }),
  maxAttempts: CONVERSATION_TURN_MAX_ATTEMPTS,
  run: ({ messageId }, { agencyId, attempt }) =>
    runAsSystem(async () => {
      const message = await findMessage(agencyId, messageId)
      if (message === null || message.direction !== 'INBOUND') return OK
      // Turns of one caregiver run in message order. The final attempt goes ahead regardless, so a
      // stuck earlier turn costs a stale step rather than an unanswered text.
      const finalAttempt = attempt >= CONVERSATION_TURN_MAX_ATTEMPTS
      if (!finalAttempt && (await hasEarlierUnfinishedTurn(agencyId, messageId, CONVERSATION_TURN_JOB_TYPE))) {
        return { status: 'retry', reason: 'earlier turn pending', retryAfterMs: 1000 }
      }
      const { caregiverId, conversationId } = message
      const conversation = await findConversation(agencyId, caregiverId)
      const view = await findConversationSnapshot(agencyId, caregiverId)
      if (conversation === null || view === null) return OK

      const reply = await replyTo(agencyId, message, conversation, view, attempt)
      if (reply === null) return OK

      await sendAgentText({
        agencyId,
        caregiverId,
        conversationId,
        phone: conversation.phone,
        body: reply,
        author: 'AGENT',
        idempotencyKey: buildIdempotencyKey('conversation.reply', [messageId]),
      })
      return OK
    }),
})
