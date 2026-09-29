import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findAutoAcceptDecision, saveAutoAcceptDecision } from '@/db/repositories/auto-accept-decisions'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { applyDocumentReviewCleared } from '@/db/repositories/document-review'
import { findDocumentExtraction } from '@/db/repositories/extractions'
import { findIntakeIdentity } from '@/db/repositories/intake-identity'
import { findJudgeDecision, findJudgeRequirement } from '@/db/repositories/judge-decisions'
import { changeRequirementInstanceStatus } from '@/db/repositories/requirement-instances'
import { autoAcceptOutcome } from '@/domain/documents/auto-accept'
import { matchIdentity } from '@/domain/identity/match'
import { acceptedDocumentStatus } from '@/domain/requirements/health-screening'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { defineJobHandler } from '@/integrations/queue/handler'
import { runAsSystem } from '@/server/auth/context'

export const AUTO_ACCEPT_DOCUMENT_JOB_TYPE = 'review.autoAcceptDocument'

/**
 * Decides one document once (ADR-101). The instance moves PENDING → IN_REVIEW → SATISFIED or
 * EXCEPTION in one transaction, because there is no PENDING → EXCEPTION edge and IN_REVIEW
 * refuses uploads. An accepted health screening document stops at IN_REVIEW, awaiting the
 * supervisor's recorded result. An instance no longer PENDING is left alone and the decision still recorded
 * (OPEN-QUESTIONS 164). A WITHDRAWN caregiver ends the job before intake is read (ADR-079).
 * Satisfying the last outstanding document requirement moves the caregiver on (ADR-111).
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
      const outcome = autoAcceptOutcome({ requirement, extraction, identity, judge })

      await runInAuditedTransaction(async (tx) => {
        let instanceStatusSet: InstanceStatus | null = null
        const review = await changeRequirementInstanceStatus(agencyId, instanceId, 'IN_REVIEW')
        if (review.ok) {
          const target = outcome.kind === 'ACCEPT' ? acceptedDocumentStatus(review.instance.templateKey) : 'EXCEPTION'
          if (target !== 'IN_REVIEW') {
            const decided = await changeRequirementInstanceStatus(agencyId, instanceId, target)
            if (!decided.ok) {
              throw new Error(`Requirement instance ${instanceId} refused IN_REVIEW → ${target}: ${decided.refusal}.`)
            }
          }
          instanceStatusSet = target
        }
        await saveAutoAcceptDecision(agencyId, { uploadedDocumentId, outcome, identity, instanceStatusSet })
        if (instanceStatusSet === 'SATISFIED') await applyDocumentReviewCleared(tx, agencyId, caregiverId, null)
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
