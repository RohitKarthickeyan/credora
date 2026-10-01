import { z } from 'zod'
import type { AuditedTx } from '../audit'
import type { PipelineStage } from '@/domain/pipeline/stage'
import { prisma } from '../prisma'

export type ConversationRow = {
  readonly id: string
  readonly caregiverId: string
  readonly phone: string
  readonly awaitingStep: string | null
  readonly unclearCount: number
  readonly pausedAt: Date | null
  readonly optedOutAt: Date | null
}

export type MessageRow = {
  readonly id: string
  readonly direction: 'INBOUND' | 'OUTBOUND'
  readonly author: 'CAREGIVER' | 'AGENT' | 'STAFF'
  readonly body: string
  readonly hasSsn: boolean
  readonly mediaStorageKey: string | null
  readonly createdAt: Date
}

export type ConversationMessage = MessageRow & { readonly conversationId: string; readonly caregiverId: string }

const CONVERSATION_SELECT = {
  id: true,
  caregiverId: true,
  phone: true,
  awaitingStep: true,
  unclearCount: true,
  pausedAt: true,
  optedOutAt: true,
} as const

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  author: true,
  body: true,
  mediaStorageKey: true,
  createdAt: true,
  ssnEnc: true,
} as const

function toMessageRow(row: {
  id: string
  direction: MessageRow['direction']
  author: MessageRow['author']
  body: string
  mediaStorageKey: string | null
  createdAt: Date
  ssnEnc: Uint8Array | null
}): MessageRow {
  const { ssnEnc, ...rest } = row
  return { ...rest, hasSsn: ssnEnc !== null }
}

export type ConversationListRow = {
  readonly caregiverId: string
  readonly caregiverName: string
  readonly stage: PipelineStage
  readonly lastMessage: string
  readonly lastMessageAt: Date
  readonly unclearCount: number
  readonly pausedAt: Date | null
}

export function ensureConversation(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  phone: string,
): Promise<ConversationRow> {
  return tx.conversation.upsert({
    where: { agencyId_caregiverId: { agencyId, caregiverId } },
    create: { agencyId, caregiverId, phone },
    update: { phone },
    select: CONVERSATION_SELECT,
  })
}

export async function findMobilePhone(tx: AuditedTx, agencyId: string, caregiverId: string): Promise<string | null> {
  const contact = await tx.contactRecord.findFirst({ where: { agencyId, caregiverId }, select: { mobilePhone: true } })
  return contact?.mobilePhone ?? null
}

const lockedConversationSchema = z.object({
  id: z.string(),
  caregiverId: z.string(),
  phone: z.string(),
  awaitingStep: z.string().nullable(),
  unclearCount: z.number().int(),
  pausedAt: z.date().nullable(),
  optedOutAt: z.date().nullable(),
})

/** Serialises the turns of one conversation: a second turn waits for this transaction. */
export async function lockConversation(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<ConversationRow | null> {
  const rows = await tx.$queryRaw`
    SELECT id, "caregiverId", phone, "awaitingStep", "unclearCount", "pausedAt", "optedOutAt"
    FROM core."Conversation"
    WHERE "agencyId" = ${agencyId} AND "caregiverId" = ${caregiverId}
    FOR UPDATE
  `
  return lockedConversationSchema.array().parse(rows)[0] ?? null
}

export async function updateConversation(
  tx: AuditedTx,
  agencyId: string,
  conversationId: string,
  patch: {
    readonly awaitingStep?: string | null
    readonly unclearCount?: number
    readonly pausedAt?: Date | null
    readonly optedOutAt?: Date | null
  },
): Promise<void> {
  await tx.conversation.update({ where: { agencyId_id: { agencyId, id: conversationId } }, data: patch })
}

export async function appendMessage(
  tx: AuditedTx,
  agencyId: string,
  input: {
    readonly conversationId: string
    readonly direction: MessageRow['direction']
    readonly author: MessageRow['author']
    readonly body: string
    readonly ssnEnc?: Uint8Array<ArrayBuffer> | null
    readonly mediaStorageKey?: string | null
  },
): Promise<{ id: string }> {
  return tx.message.create({
    data: {
      agencyId,
      conversationId: input.conversationId,
      direction: input.direction,
      author: input.author,
      body: input.body,
      ssnEnc: input.ssnEnc ?? null,
      mediaStorageKey: input.mediaStorageKey ?? null,
    },
    select: { id: true },
  })
}

export async function listMessages(
  agencyId: string,
  conversationId: string,
  limit: number,
): Promise<readonly MessageRow[]> {
  const rows = await prisma.message.findMany({
    where: { agencyId, conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: MESSAGE_SELECT,
  })
  return rows.reverse().map(toMessageRow)
}

export async function findConversation(
  agencyId: string,
  caregiverId: string,
): Promise<ConversationRow | null> {
  return prisma.conversation.findUnique({
    where: { agencyId_caregiverId: { agencyId, caregiverId } },
    select: CONVERSATION_SELECT,
  })
}

/** One row per conversation that has a message, newest message first. */
export async function listConversations(agencyId: string): Promise<readonly ConversationListRow[]> {
  const rows = await prisma.conversation.findMany({
    where: { agencyId, messages: { some: {} } },
    select: {
      caregiverId: true,
      unclearCount: true,
      pausedAt: true,
      caregiver: {
        select: {
          stage: true,
          identity: { select: { legalFirstName: true, legalLastName: true } },
        },
      },
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  })
  return rows
    .flatMap(({ messages: [last], caregiver, ...row }) =>
      last === undefined
        ? []
        : [
            {
              ...row,
              caregiverName:
                [caregiver.identity?.legalFirstName, caregiver.identity?.legalLastName]
                  .filter(Boolean)
                  .join(' ') || 'Name not yet provided',
              stage: caregiver.stage,
              lastMessage: last.body,
              lastMessageAt: last.createdAt,
            },
          ],
    )
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
}

export async function findMessage(
  agencyId: string,
  messageId: string,
): Promise<ConversationMessage | null> {
  const row = await prisma.message.findFirst({
    where: { agencyId, id: messageId },
    select: { ...MESSAGE_SELECT, conversationId: true, conversation: { select: { caregiverId: true } } },
  })
  if (row === null) return null
  const { conversationId, conversation, ...message } = row
  return { ...toMessageRow(message), conversationId, caregiverId: conversation.caregiverId }
}

/**
 * Whether an earlier inbound message of the same conversation still has a turn job queued or
 * running. The turn job's payload is `{ messageId }`.
 */
export async function hasEarlierUnfinishedTurn(
  agencyId: string,
  messageId: string,
  turnJobType: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ blocked: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM core."Message" message
      JOIN core."Message" earlier
        ON earlier."agencyId" = message."agencyId" AND earlier."conversationId" = message."conversationId"
      JOIN core."Job" job
        ON job."agencyId" = earlier."agencyId" AND job.payload->>'messageId' = earlier.id
      WHERE message."agencyId" = ${agencyId}
        AND message.id = ${messageId}
        AND earlier.direction = 'INBOUND'
        AND (earlier."createdAt", earlier.id) < (message."createdAt", message.id)
        AND job.type = ${turnJobType}
        AND job.state IN ('PENDING', 'RUNNING')
    ) AS blocked
  `
  return rows[0]?.blocked ?? false
}

/** More than one live caregiver on a number is ambiguous, so no match (as the email lookup). */
export async function findLiveCaregiverByPhone(
  agencyId: string,
  phone: string,
): Promise<{ caregiverId: string } | null> {
  const rows = await prisma.contactRecord.findMany({
    where: { agencyId, mobilePhone: phone, caregiver: { stage: { not: 'WITHDRAWN' } } },
    select: { caregiverId: true },
    take: 2,
  })
  const [only] = rows
  return rows.length === 1 && only !== undefined ? { caregiverId: only.caregiverId } : null
}

/** Dev web phone only — a declared unscoped read, like listOutboxMessages (ADR-043). */
export async function findPhoneContext(caregiverId: string): Promise<{
  agencyId: string
  name: string
  mobilePhone: string | null
  conversationId: string | null
} | null> {
  const caregiver = await prisma.caregiver.findFirst({
    where: { id: caregiverId },
    select: {
      agencyId: true,
      identity: { select: { legalFirstName: true, legalLastName: true } },
      contact: { select: { mobilePhone: true } },
      conversation: { select: { id: true } },
    },
  })
  if (caregiver === null) return null
  const { legalFirstName, legalLastName } = caregiver.identity ?? {}
  return {
    agencyId: caregiver.agencyId,
    name: [legalFirstName, legalLastName].filter(Boolean).join(' ') || 'Caregiver',
    mobilePhone: caregiver.contact?.mobilePhone ?? null,
    conversationId: caregiver.conversation?.id ?? null,
  }
}

/** Dev tools index of the web phone: every caregiver invited with a mobile number. */
export async function listPhoneCaregivers(): Promise<{ caregiverId: string; mobilePhone: string }[]> {
  const rows = await prisma.contactRecord.findMany({
    where: { mobilePhone: { not: null } },
    select: { caregiverId: true, mobilePhone: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.flatMap((row) =>
    row.mobilePhone === null ? [] : [{ caregiverId: row.caregiverId, mobilePhone: row.mobilePhone }],
  )
}
