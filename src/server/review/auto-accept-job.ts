import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findAutoAcceptDecision, saveAutoAcceptDecision } from '@/db/repositories/auto-accept-decisions'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { findDocumentExtraction } from '@/db/repositories/extractions'
import { findIntakeIdentity } from '@/db/repositories/intake-identity'
import { findJudgeDecision, findJudgeRequirement } from '@/db/repositories/judge-decisions'
import { changeRequirementInstanceStatus } from '@/db/repositories/requirement-instances'
import { reviewOutcome } from '@/domain/documents/review-outcome'
import { matchIdentity } from '@/domain/identity/match'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { defineJobHandler } from '@/integrations/queue/handler'
import { runAsSystem } from '@/server/auth/context'
import { enqueueNudge } from '@/server/conversation/nudge-job'

export const AUTO_ACCEPT_DOCUMENT_JOB_TYPE = 'review.autoAcceptDocument'

/**
 * Decides one document once, and never accepts it (ADR-164): returned to the caregiver or sent to
 * staff, the instance moves PENDING → IN_REVIEW → EXCEPTION in one transaction, because there is
 * no PENDING → EXCEPTION edge and IN_REVIEW refuses uploads. Either way the caregiver is texted what
 * comes next: the return's reason, or the next request. An instance no longer PENDING is left alone and the decision still recorded
 * (OPEN-QUESTIONS 164). A WITHDRAWN caregiver ends the job before intake is read (ADR-079).
 */
export const autoAcceptDocumentJob = defineJobHandler({
  type: AUTO_ACCEPT_DOCUMENT_JOB_TYPE,
  schema: z.object({ uploadedDocumentId: z.uuid() }),
  run: ({ uploadedDocumentId }, { agencyId }) =>
    runAsSystem(async () => {
      if ((await findAutoAcceptDecision(agencyId, uploadedDocumentId)) !== null) return { status: 'ok' }
      const extraction = await findDocumentExtraction(agencyId, uploadedDocumentId)
      if (extraction === null) return { status: 'ok' }
      const { caregiverId, instanceId } = extraction
      const caregiver = await findCaregiverForSession(agencyId, caregiverId)
      if (caregiver === null || caregiver.stage === 'WITHDRAWN') return { status: 'ok' }

      const requirement = await findJudgeRequirement(agencyId, instanceId)
      const identity = matchIdentity(await findIntakeIdentity(agencyId, caregiverId), extraction.fields)
      const judge = (await findJudgeDecision(agencyId, uploadedDocumentId))?.outcome ?? null
      const outcome = reviewOutcome({ requirement, extraction, identity, judge })

      await runInAuditedTransaction(async (tx) => {
        let instanceStatusSet: InstanceStatus | null = null
        if ((await changeRequirementInstanceStatus(agencyId, instanceId, 'IN_REVIEW')).ok) {
          const flagged = await changeRequirementInstanceStatus(agencyId, instanceId, 'EXCEPTION')
          if (!flagged.ok) {
            throw new Error(`Requirement instance ${instanceId} refused IN_REVIEW → EXCEPTION: ${flagged.refusal}.`)
          }
          instanceStatusSet = 'EXCEPTION'
        }
        await saveAutoAcceptDecision(agencyId, { uploadedDocumentId, outcome, identity, instanceStatusSet })
        await enqueueNudge(tx, agencyId, caregiverId, null, `reviewed:${uploadedDocumentId}`)
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'CAREGIVER',
          entityId: caregiverId,
          fieldName: 'autoAcceptDecisions',
        })
      })
      return { status: 'ok' }
    }),
})
