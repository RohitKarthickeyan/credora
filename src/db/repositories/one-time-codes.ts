import { ONE_TIME_CODE_MAX_ATTEMPTS, ONE_TIME_CODE_TTL_MS } from '@/domain/auth/one-time-code'
import type { AuditedTx } from '../audit'
import { prisma } from '../prisma'

export type OneTimeCodeRow = {
  readonly id: string
  readonly caregiverId: string
  readonly codeHash: string
  readonly attempts: number
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

const rowSelect = {
  id: true,
  caregiverId: true,
  codeHash: true,
  attempts: true,
  expiresAt: true,
  consumedAt: true,
} as const

export function countOneTimeCodesSince(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  since: Date,
): Promise<number> {
  return tx.oneTimeCode.count({ where: { agencyId, caregiverId, createdAt: { gte: since } } })
}

/** Mint a code row and expire the caregiver's live one, so at most one code works at a time. */
export async function createOneTimeCode(
  tx: AuditedTx,
  agencyId: string,
  input: {
    readonly id: string
    readonly caregiverId: string
    readonly codeHash: string
    readonly now: Date
  },
): Promise<{ readonly id: string; readonly expiresAt: Date }> {
  await tx.oneTimeCode.updateMany({
    where: {
      agencyId,
      caregiverId: input.caregiverId,
      consumedAt: null,
      expiresAt: { gt: input.now },
    },
    data: { expiresAt: input.now },
  })

  return tx.oneTimeCode.create({
    data: {
      id: input.id,
      agencyId,
      caregiverId: input.caregiverId,
      codeHash: input.codeHash,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + ONE_TIME_CODE_TTL_MS),
    },
    select: { id: true, expiresAt: true },
  })
}

/**
 * Count an attempt before the code is compared. The conditional increment is what bounds
 * concurrent guessing: however many requests race, at most MAX of them are counted, and an
 * uncounted attempt is never compared.
 */
export async function recordOneTimeCodeAttempt(
  agencyId: string,
  codeId: string,
  now: Date,
): Promise<{ readonly counted: boolean; readonly code: OneTimeCodeRow | null }> {
  const { count } = await prisma.oneTimeCode.updateMany({
    where: {
      agencyId,
      id: codeId,
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  })
  const code = await prisma.oneTimeCode.findFirst({
    where: { agencyId, id: codeId },
    select: rowSelect,
  })
  return { counted: count === 1, code }
}

export async function consumeOneTimeCode(
  agencyId: string,
  codeId: string,
  now: Date,
): Promise<boolean> {
  const { count } = await prisma.oneTimeCode.updateMany({
    where: { agencyId, id: codeId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  })
  return count === 1
}

export async function expireOneTimeCode(agencyId: string, codeId: string, now: Date): Promise<void> {
  await prisma.oneTimeCode.updateMany({
    where: { agencyId, id: codeId },
    data: { expiresAt: now },
  })
}
