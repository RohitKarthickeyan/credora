import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createInvite, findInviteResendState } from '@/db/repositories/invites'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import type { InviteResendRefusal } from '@/domain/pipeline/invite'
import { inviteResendRefusal } from '@/domain/pipeline/invite'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { INVITE_EMAIL_JOB_TYPE } from './invite-email-job'

export type ResendInviteResult =
  | { readonly ok: true; readonly inviteId: string }
  | { readonly ok: false; readonly reason: InviteResendRefusal | 'NOT_FOUND' }

// A new Invite rather than re-queuing the old one, which stays as history (ADR-095). No link is
// touched here: the job mints one at send time, and that supersedes the old link.
export const resendInvite: UseCase<{ readonly caregiverId: string }, ResendInviteResult> =
  defineUseCase('caregiver.invite', async ({ principal, input }) =>
    runInAuditedTransaction(async (tx) => {
      const { agencyId } = principal
      const state = await findInviteResendState(tx, agencyId, input.caregiverId)
      if (state === null) return { ok: false, reason: 'NOT_FOUND' }

      const refusal = inviteResendRefusal(state)
      if (refusal !== null) return { ok: false, reason: refusal }

      const { inviteId } = await createInvite(tx, agencyId, input.caregiverId)
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: INVITE_EMAIL_JOB_TYPE,
        payload: { inviteId },
        idempotencyKey: buildIdempotencyKey(INVITE_EMAIL_JOB_TYPE, [inviteId]),
      })
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: input.caregiverId,
      })
      return { ok: true, inviteId }
    }),
  )
