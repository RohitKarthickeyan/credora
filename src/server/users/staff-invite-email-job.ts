import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { issueLinkToken } from '@/db/repositories/link-tokens'
import { findPendingStaffUser } from '@/db/repositories/users'
import { LINK_TOKEN_TTL_DAYS } from '@/domain/auth/link-token'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { runAsSystem } from '@/server/auth/context'

export const STAFF_INVITE_EMAIL_JOB_TYPE = 'staffUser.inviteEmail'

function inviteBody(agencyName: string, token: string): string {
  return (
    `${agencyName} added you to Credora. Choose a password to sign in: ` +
    `${env.APP_URL}/r/staff-invite/${token} This link expires in ${LINK_TOKEN_TTL_DAYS.STAFF_INVITE} days.`
  )
}

/**
 * Emails one staff invite. The link is minted here, not at invite time, because only its hash is
 * stored. A user who has since set a password or been deactivated gets nothing. A VendorUnavailableError
 * escapes so the queue retries, and the retry mints a fresh link that supersedes this one.
 */
export const staffInviteEmailJob = defineJobHandler({
  type: STAFF_INVITE_EMAIL_JOB_TYPE,
  schema: z.object({ userId: z.uuid() }),
  run: ({ userId }, { agencyId, now }) =>
    runAsSystem(async () => {
      const prepared = await runInAuditedTransaction(async (tx) => {
        const user = await findPendingStaffUser(tx, agencyId, userId)
        if (user === null) return null

        const issued = await issueLinkToken(tx, agencyId, { purpose: 'STAFF_INVITE', userId, now })
        return { user, issued }
      })
      if (prepared === null) return { status: 'ok' }

      const result = await getPort('messaging').send({
        agencyId,
        to: prepared.user.email,
        subject: 'Set up your Credora account',
        body: inviteBody(prepared.user.agencyName, prepared.issued.token),
        idempotencyKey: buildIdempotencyKey('staffUser.inviteEmail.send', [prepared.issued.id]),
      })
      return result.status === 'sent'
        ? { status: 'ok' }
        : { status: 'fail', reason: `invite email rejected: ${result.reason}` }
    }),
})
