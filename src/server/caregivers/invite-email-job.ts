import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findInviteForSend, recordInviteOutcome } from '@/db/repositories/invites'
import { issueLinkToken } from '@/db/repositories/link-tokens'
import { LINK_TOKEN_TTL_DAYS } from '@/domain/auth/link-token'
import { inviteSendRefusal } from '@/domain/pipeline/invite'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { runAsSystem } from '@/server/auth/context'

export const INVITE_EMAIL_JOB_TYPE = 'caregiver.inviteEmail'

// Names the agency and never the caregiver: a shared inbox or a lock-screen preview shows this.
function inviteBody(agencyName: string, token: string): string {
  return (
    `${agencyName} invited you to start your onboarding paperwork: ` +
    `${env.APP_URL}/r/invite/${token} This link expires in ${LINK_TOKEN_TTL_DAYS.INVITE} days.`
  )
}

/**
 * Sends one invite email. The link is minted here, not at invite time, because only its hash is
 * stored (ADR-027). Stage and email are re-checked at send time. A `rejected` send is
 * permanent and recorded on the Invite, never retried; a VendorUnavailableError escapes so the
 * queue retries, and the retry mints a fresh link that supersedes this one.
 */
export const inviteEmailJob = defineJobHandler({
  type: INVITE_EMAIL_JOB_TYPE,
  schema: z.object({ inviteId: z.uuid() }),
  run: ({ inviteId }, { agencyId, now }) =>
    runAsSystem(async () => {
      const prepared = await runInAuditedTransaction(async (tx) => {
        const invite = await findInviteForSend(tx, agencyId, inviteId)
        if (invite === null || invite.status !== 'QUEUED') return null

        const refusal = inviteSendRefusal(invite)
        if (refusal !== null || invite.email === null) {
          await recordInviteOutcome(
            tx,
            agencyId,
            inviteId,
            { status: 'CANCELLED', reason: refusal ?? 'NO_EMAIL' },
            now,
          )
          return null
        }

        const issued = await issueLinkToken(tx, agencyId, {
          purpose: 'INVITE',
          caregiverId: invite.caregiverId,
          now,
        })
        return { to: invite.email, agencyName: invite.agencyName, issued }
      })
      if (prepared === null) return { status: 'ok' }

      const result = await getPort('messaging').send({
        agencyId,
        to: prepared.to,
        subject: `${prepared.agencyName} invited you to start your onboarding`,
        body: inviteBody(prepared.agencyName, prepared.issued.token),
        idempotencyKey: buildIdempotencyKey('caregiver.inviteEmail.send', [prepared.issued.id]),
      })

      await runInAuditedTransaction((tx) =>
        recordInviteOutcome(
          tx,
          agencyId,
          inviteId,
          result.status === 'sent'
            ? { status: 'SENT' }
            : { status: 'REJECTED', reason: result.reason },
          now,
        ),
      )
      return { status: 'ok' }
    }),
})
