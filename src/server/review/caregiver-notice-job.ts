import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findCaregiverNoticeForSend, recordCaregiverNoticeOutcome } from '@/db/repositories/staff-decisions'
import { type StaffDecision, caregiverNoticeRefusal } from '@/domain/documents/staff-decision'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { runAsSystem } from '@/server/auth/context'

export const CAREGIVER_NOTICE_JOB_TYPE = 'review.caregiverNotice'

const SUBJECT = 'An update about your documents'

// Names the agency only, never the caregiver, the requirement or the reason: anyone with the
// inbox reads it, and a TB result named in a subject or preview is health information (ADR-110).
function body(decision: StaffDecision, agencyName: string): string {
  switch (decision) {
    case 'REJECTED':
      return `${agencyName} could not accept a document you uploaded for your onboarding. Please sign in and upload a different one: ${env.APP_URL}/documents`
    case 'REUPLOAD_REQUESTED':
      return `${agencyName} could not read a document you uploaded for your onboarding. Please sign in and upload a clearer photo: ${env.APP_URL}/documents`
    case 'ACCEPTED':
      throw new Error('An accepted document queues no caregiver notice.')
  }
}

/**
 * Emails the caregiver that staff returned a document. Stage, instance status and email are
 * re-checked at send time (ADR-079). A `rejected` send is permanent and recorded, never
 * retried; a VendorUnavailableError escapes so the queue retries.
 */
export const caregiverNoticeJob = defineJobHandler({
  type: CAREGIVER_NOTICE_JOB_TYPE,
  schema: z.object({ staffDecisionId: z.uuid() }),
  run: ({ staffDecisionId }, { agencyId, now }) =>
    runAsSystem(async () => {
      const prepared = await runInAuditedTransaction(async (tx) => {
        const notice = await findCaregiverNoticeForSend(tx, agencyId, staffDecisionId)
        if (notice === null || notice.notice !== 'QUEUED') return null

        const refusal = caregiverNoticeRefusal(notice)
        if (refusal !== null || notice.email === null) {
          await recordCaregiverNoticeOutcome(tx, agencyId, staffDecisionId, refusal ?? 'NO_EMAIL', now)
          return null
        }
        return { to: notice.email, body: body(notice.decision, notice.agencyName) }
      })
      if (prepared === null) return { status: 'ok' }

      const result = await getPort('messaging').send({
        agencyId,
        to: prepared.to,
        subject: SUBJECT,
        body: prepared.body,
        idempotencyKey: buildIdempotencyKey('review.caregiverNotice.send', [staffDecisionId]),
      })

      await runInAuditedTransaction((tx) =>
        recordCaregiverNoticeOutcome(tx, agencyId, staffDecisionId, result.status === 'sent' ? 'SENT' : 'REJECTED', now),
      )
      return { status: 'ok' }
    }),
})
