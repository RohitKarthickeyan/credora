import 'server-only'
import { addHours } from 'date-fns'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createSchedule } from '@/db/repositories/job-schedules'
import { issueLinkToken } from '@/db/repositories/link-tokens'
import {
  type ReferenceChase,
  escalateReference,
  findReferenceChase,
  markReferenceAttemptUnanswered,
  recordReferenceAttemptOutcome,
  startReferenceAttempt,
} from '@/db/repositories/reference-checks'
import { LINK_TOKEN_TTL_DAYS } from '@/domain/auth/link-token'
import {
  REFERENCE_ATTEMPT_LIMIT,
  REFERENCE_RESPONSE_WINDOW_HOURS,
  nextChaseStep,
} from '@/domain/requirements/reference-check'
import type { SendMessageInput } from '@/integrations/ports/messaging'
import { type JobOutcome, defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { stopSchedule } from '@/integrations/queue/schedule'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { runAsSystem } from '@/server/auth/context'

export const REFERENCE_CHASE_JOB_TYPE = 'reference.chase'

const chaseScheduleKey = (referenceId: string) => `reference.chase:${referenceId}`

// The caregiver's name is the only caregiver field a message carries.
function message(agencyId: string, chase: ReferenceChase, to: string, token: string, idempotencyKey: string): SendMessageInput {
  const who = chase.caregiverName ?? 'a caregiver'
  return {
    agencyId,
    to,
    subject: `Reference request for ${who}`,
    body:
      `${chase.agencyName}: ${who} gave your name as a work reference. ` +
      `Please answer 3 short questions: ${env.APP_URL}/r/reference/${token}\n\n` +
      `This link expires in ${LINK_TOKEN_TTL_DAYS.REFERENCE_FORM} days.`,
    idempotencyKey,
  }
}

/**
 * One attempt: the link is minted and the attempt logged in one transaction, the email goes out
 * with no transaction open, and the outcome is recorded in a second; a reference with no email
 * is logged NO_CONTACT_DETAILS for staff to call. A VendorUnavailableError escapes so the queue
 * retries; the retry finds the attempt QUEUED and resumes it with a fresh link, which expires
 * this one.
 */
async function sendAttempt(
  agencyId: string,
  chase: ReferenceChase,
  number: number,
  unanswered: string | null,
  now: Date,
): Promise<void> {
  const { attempt, issued } = await runInAuditedTransaction(async (tx) => {
    if (unanswered !== null) await markReferenceAttemptUnanswered(tx, agencyId, unanswered)
    return {
      attempt: await startReferenceAttempt(tx, agencyId, chase.referenceId, number),
      issued: await issueLinkToken(tx, agencyId, {
        purpose: 'REFERENCE_FORM',
        caregiverId: chase.caregiverId,
        referenceId: chase.referenceId,
        now,
      }),
    }
  })

  const result =
    chase.email === null
      ? null
      : await getPort('messaging').send(
          message(agencyId, chase, chase.email, issued.token, buildIdempotencyKey('reference.chase.send', [issued.id])),
        )

  await runInAuditedTransaction(async (tx) => {
    if (result?.status !== 'sent') {
      await recordReferenceAttemptOutcome(tx, agencyId, attempt.id, {
        status: 'REJECTED',
        reason: result?.reason ?? 'NO_CONTACT_DETAILS',
      })
      return
    }
    await recordReferenceAttemptOutcome(tx, agencyId, attempt.id, { status: 'SENT', sentAt: now })
    // The caregiver's name left Credora in the message.
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EXPORT',
      entityType: 'CAREGIVER',
      entityId: chase.caregiverId,
      fieldName: 'references',
    })
  })
}

/**
 * Chases one reference from its attempt log: send, wait out the response window, send once more
 * after a miss, and escalate to staff after the second. It runs from the request and then from
 * the schedule every window. A withdrawn caregiver's reference is never contacted again.
 */
export const referenceChaseJob = defineJobHandler({
  type: REFERENCE_CHASE_JOB_TYPE,
  schema: z.object({ referenceId: z.uuid() }),
  run: ({ referenceId }, { agencyId, now }) =>
    runAsSystem(async (): Promise<JobOutcome> => {
      const key = chaseScheduleKey(referenceId)

      for (let run = 0; run <= REFERENCE_ATTEMPT_LIMIT; run++) {
        const chase = await findReferenceChase(agencyId, referenceId)
        if (
          chase === null ||
          chase.caregiverStage === 'WITHDRAWN' ||
          chase.requestStatus !== 'REQUESTED' ||
          chase.checkStatus !== 'PENDING'
        ) {
          await stopSchedule(agencyId, key, now)
          return { status: 'ok' }
        }

        const { unanswered, next } = nextChaseStep(chase.attempts, now)
        if (next.kind === 'WAIT') {
          await createSchedule({
            agencyId,
            key,
            jobType: REFERENCE_CHASE_JOB_TYPE,
            payload: { referenceId },
            intervalSeconds: REFERENCE_RESPONSE_WINDOW_HOURS * 3600,
            firstOccurrenceAt: addHours(now, REFERENCE_RESPONSE_WINDOW_HOURS),
          })
          return { status: 'ok' }
        }

        if (next.kind === 'ESCALATE') {
          await runInAuditedTransaction(async (tx) => {
            if (unanswered !== null) await markReferenceAttemptUnanswered(tx, agencyId, unanswered)
            if (!(await escalateReference(tx, agencyId, referenceId, now))) return
            await writeAuditEntry(tx, {
              agencyId,
              action: 'EDIT',
              entityType: 'CAREGIVER',
              entityId: chase.caregiverId,
              fieldName: 'references',
            })
          })
          await stopSchedule(agencyId, key, now)
          return { status: 'ok' }
        }

        await sendAttempt(agencyId, chase, next.number, unanswered, now)
      }

      throw new Error(`Reference ${referenceId} was still sending after ${REFERENCE_ATTEMPT_LIMIT + 1} steps.`)
    }),
})
