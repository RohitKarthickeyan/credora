import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { enqueueJobInTransaction, isIdempotencyKeyConflict } from '@/db/repositories/jobs'
import { deleteStaffMfa } from '@/db/repositories/staff-mfa'
import * as repository from '@/db/repositories/users'
import type {
  StaffAccessChange,
  StaffRole,
  StaffUser,
  StaffUserInvite,
  StaffUserWriteResult,
} from '@/domain/auth/staff-user'
import { STAFF_ROLES, lastAdminRefusal, staffUserInviteSchema } from '@/domain/auth/staff-user'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { STAFF_INVITE_EMAIL_JOB_TYPE } from './staff-invite-email-job'

const OK = { ok: true } as const
const userIdSchema = z.strictObject({ userId: z.string().min(1) })
const roleInputSchema = userIdSchema.extend({ role: z.enum(STAFF_ROLES) })
const activeInputSchema = userIdSchema.extend({ isActive: z.boolean() })

// Keyed on a fresh uuid: the unit of work is one admin request, and there is no invite row.
async function enqueueInviteEmail(tx: AuditedTx, agencyId: string, userId: string): Promise<void> {
  await enqueueJobInTransaction(tx, {
    agencyId,
    type: STAFF_INVITE_EMAIL_JOB_TYPE,
    payload: { userId },
    idempotencyKey: buildIdempotencyKey(STAFF_INVITE_EMAIL_JOB_TYPE, [userId, randomUUID()]),
  })
}

// Every write of User.role or User.isActive comes through here, after the agency row is locked,
// so the last-admin rule holds under concurrency.
function applyAccessChange(
  agencyId: string,
  userId: string,
  change: StaffAccessChange,
): Promise<StaffUserWriteResult> {
  return runInAuditedTransaction(async (tx) => {
    const admins = await repository.lockAgencyAndCountSignInAbleAdmins(tx, agencyId)
    const user = await repository.findStaffUser(tx, agencyId, userId)
    if (user === null) return { ok: false, reason: 'NOT_FOUND' }

    const fieldName = 'role' in change ? 'role' : 'isActive'
    if ('role' in change ? user.role === change.role : user.isActive === change.isActive) return OK

    const refusal = lastAdminRefusal(user, change, admins)
    if (refusal !== null) return { ok: false, reason: refusal }

    await repository.updateStaffUserAccess(tx, agencyId, userId, change)
    await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'USER', entityId: userId, fieldName })
    return OK
  })
}

export const listStaffUsers: UseCase<Record<string, never>, readonly StaffUser[]> = defineUseCase(
  'user.manage',
  async ({ principal }) => repository.listStaffUsers(principal.agencyId),
)

export const inviteStaffUser: UseCase<StaffUserInvite, StaffUserWriteResult> = defineUseCase(
  'user.manage',
  async ({ principal, input }) => {
    const { agencyId } = principal
    const data = staffUserInviteSchema.parse(input)
    // Outside the transaction: a unique violation aborts it. Email is globally unique, so there
    // is no agency-scoped read that could check first.
    try {
      return await runInAuditedTransaction(async (tx) => {
        const { id } = await repository.createStaffUser(tx, agencyId, data)
        await enqueueInviteEmail(tx, agencyId, id)
        await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'USER', entityId: id })
        return OK
      })
    } catch (error) {
      if (isIdempotencyKeyConflict(error, 'User_email_key')) return { ok: false, reason: 'EMAIL_TAKEN' }
      throw error
    }
  },
)

export const changeStaffRole: UseCase<
  { readonly userId: string; readonly role: StaffRole },
  StaffUserWriteResult
> = defineUseCase('user.manage', async ({ principal, input }) => {
  const { userId, role } = roleInputSchema.parse(input)
  return applyAccessChange(principal.agencyId, userId, { role })
})

export const setStaffUserActive: UseCase<
  { readonly userId: string; readonly isActive: boolean },
  StaffUserWriteResult
> = defineUseCase('user.manage', async ({ principal, input }) => {
  const { userId, isActive } = activeInputSchema.parse(input)
  return applyAccessChange(principal.agencyId, userId, { isActive })
})

// No token is touched: the job mints one, and that supersedes the last.
export const resendStaffInvite: UseCase<{ readonly userId: string }, StaffUserWriteResult> =
  defineUseCase('user.manage', async ({ principal, input }) => {
    const { agencyId } = principal
    const { userId } = userIdSchema.parse(input)
    return runInAuditedTransaction(async (tx) => {
      const user = await repository.findStaffUser(tx, agencyId, userId)
      if (user === null) return { ok: false, reason: 'NOT_FOUND' }
      if (!user.isActive || !user.invitePending) return { ok: false, reason: 'NOT_PENDING' }

      await enqueueInviteEmail(tx, agencyId, userId)
      await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'USER', entityId: userId })
      return OK
    })
  })

// Nothing to reset is not a refusal. The user sets up a new secret at their next sign-in; a
// session already open runs to its expiry (ADR-026).
export const resetStaffMfa: UseCase<{ readonly userId: string }, StaffUserWriteResult> =
  defineUseCase('user.manage', async ({ principal, input }) => {
    const { agencyId } = principal
    const { userId } = userIdSchema.parse(input)
    return runInAuditedTransaction(async (tx) => {
      if ((await repository.findStaffUser(tx, agencyId, userId)) === null) {
        return { ok: false, reason: 'NOT_FOUND' }
      }
      if (await deleteStaffMfa(tx, agencyId, userId)) {
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'USER',
          entityId: userId,
          fieldName: 'totpSecretEnc',
        })
      }
      return OK
    })
  })
