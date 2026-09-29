import { MFA_MAX_ATTEMPTS } from '@/domain/auth/mfa'
import type { AuditedTx } from '../audit'
import { decryptField, encryptField } from '../crypto'
import { prisma } from '../prisma'

// The one reader of StaffMfa.totpSecretEnc (ADR-142): a TOTP check needs the secret itself.

function openSecret(envelope: Uint8Array | null): string {
  const secret = decryptField(envelope)
  if (secret === null) throw new Error('StaffMfa row has no TOTP secret')
  return secret
}

// Only called after the password matched, so the extra read is no timing signal for an unknown email.
export async function findStaffSecondFactorState(
  agencyId: string,
  userId: string,
): Promise<{ readonly mfaRequired: boolean; readonly enrolled: boolean }> {
  const user = await prisma.user.findFirstOrThrow({
    where: { agencyId, id: userId },
    select: { agency: { select: { mfaRequired: true } }, staffMfa: { select: { enrolledAt: true } } },
  })
  return {
    mfaRequired: user.agency.mfaRequired,
    enrolled: user.staffMfa !== null && user.staffMfa.enrolledAt !== null,
  }
}

/** Create-if-absent, so a reload or a second tab shows the secret the app has already scanned. */
export async function ensureStaffMfaEnrolment(
  agencyId: string,
  userId: string,
  candidateSecret: string,
): Promise<
  | { readonly enrolled: true }
  | { readonly enrolled: false; readonly secret: string; readonly email: string }
> {
  await prisma.staffMfa.createMany({
    data: [{ agencyId, userId, totpSecretEnc: encryptField(candidateSecret) }],
    skipDuplicates: true,
  })
  const row = await prisma.staffMfa.findFirstOrThrow({
    where: { agencyId, userId },
    select: { totpSecretEnc: true, enrolledAt: true, user: { select: { email: true } } },
  })
  if (row.enrolledAt !== null) return { enrolled: true }
  return { enrolled: false, secret: openSecret(row.totpSecretEnc), email: row.user.email }
}

/** Counts the attempt before the caller compares anything; `counted: false` means locked. */
export async function recordStaffMfaAttempt(
  agencyId: string,
  userId: string,
): Promise<{
  readonly counted: boolean
  readonly mfa: { readonly secret: string; readonly enrolled: boolean; readonly attempts: number } | null
}> {
  const { count } = await prisma.staffMfa.updateMany({
    where: { agencyId, userId, attempts: { lt: MFA_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  })
  const row = await prisma.staffMfa.findFirst({
    where: { agencyId, userId },
    select: { totpSecretEnc: true, enrolledAt: true, attempts: true },
  })
  return {
    counted: count === 1,
    mfa:
      row === null
        ? null
        : { secret: openSecret(row.totpSecretEnc), enrolled: row.enrolledAt !== null, attempts: row.attempts },
  }
}

export async function completeStaffMfaEnrolment(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
  input: { readonly step: number; readonly recoveryCodeHashes: readonly string[]; readonly now: Date },
): Promise<boolean> {
  const { count } = await tx.staffMfa.updateMany({
    where: { agencyId, userId, enrolledAt: null },
    data: { enrolledAt: input.now, lastUsedStep: input.step, attempts: 0 },
  })
  if (count === 0) return false
  await tx.staffRecoveryCode.createMany({
    data: input.recoveryCodeHashes.map((codeHash) => ({ agencyId, userId, codeHash })),
  })
  return true
}

// RFC 6238 § 5.2: a step at or below the last accepted one is refused, so no code is used twice.
export async function acceptStaffTotpStep(agencyId: string, userId: string, step: number): Promise<boolean> {
  const { count } = await prisma.staffMfa.updateMany({
    where: {
      agencyId,
      userId,
      enrolledAt: { not: null },
      OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
    },
    data: { lastUsedStep: step, attempts: 0 },
  })
  return count === 1
}

export async function consumeStaffRecoveryCode(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
  codeHash: string,
  now: Date,
): Promise<boolean> {
  const { count } = await tx.staffRecoveryCode.updateMany({
    where: { agencyId, userId, codeHash, usedAt: null },
    data: { usedAt: now },
  })
  if (count === 0) return false
  await tx.staffMfa.updateMany({ where: { agencyId, userId }, data: { attempts: 0 } })
  return true
}

/** Recovery codes go with it, by foreign-key cascade. */
export async function deleteStaffMfa(tx: AuditedTx, agencyId: string, userId: string): Promise<boolean> {
  const { count } = await tx.staffMfa.deleteMany({ where: { agencyId, userId } })
  return count === 1
}
