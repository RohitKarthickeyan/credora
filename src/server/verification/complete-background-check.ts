import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findCaregiverWorkState } from '@/db/repositories/background-check-orders'
import { createCheckResult } from '@/db/repositories/check-results'
import { findClearanceSheet } from '@/db/repositories/clearance'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import {
  changeRequirementInstanceStatus,
  linkEvidence,
  requireStatusChanged,
} from '@/db/repositories/requirement-instances'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import { applyVerificationCompleted } from '@/db/repositories/verification'
import {
  BACKGROUND_CHECK_REQUIREMENT_KEY,
  BACKGROUND_CHECK_RESULT_EVIDENCE_KEY,
  fcraConsentOnFile,
} from '@/domain/requirements/background-check'
import { clearanceReadiness } from '@/domain/requirements/clearance'
import { manualCheckPath } from '@/domain/requirements/manual-check'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { enqueueNudge } from '@/server/conversation/nudge-job'
import { recordCaregiverCredentials } from '@/server/credentials/record-credentials'

type CompleteBackgroundCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NOT_DEMO' | 'NOT_READY' | 'FCRA_NOT_SIGNED' }

const inputSchema = z.object({ caregiverId: z.uuid() })

/**
 * The demo has no background-check vendor: staff record the check as clear, which clears the
 * caregiver and leaves them Ready for AlayaCare (ADR-166).
 */
export const completeBackgroundCheck: UseCase<{ readonly caregiverId: string }, CompleteBackgroundCheckResult> =
  defineUseCase('backgroundCheck.complete', async ({ principal, input: raw }) => {
    const { caregiverId } = inputSchema.parse(raw)
    const { agencyId } = principal

    return runInAuditedTransaction(async (tx): Promise<CompleteBackgroundCheckResult> => {
      const sheet = await findClearanceSheet(tx, agencyId, caregiverId)
      if (sheet === null) throw new Error(`Caregiver ${caregiverId} does not exist in agency ${agencyId}.`)

      if ((await findCaregiverWorkState(tx, agencyId, caregiverId)) !== 'DEMO') {
        return { ok: false, reason: 'NOT_DEMO' }
      }
      const check = sheet.requirements.find(({ templateKey }) => templateKey === BACKGROUND_CHECK_REQUIREMENT_KEY)
      const path = check === undefined ? null : manualCheckPath(check.status)
      const othersReady = clearanceReadiness(
        sheet.requirements.map((requirement) =>
          requirement === check ? { ...requirement, status: 'SATISFIED' as const } : requirement,
        ),
      ).ready
      if (sheet.stage !== 'VERIFICATION' || check === undefined || path === null || !path.ok || !othersReady) {
        return { ok: false, reason: 'NOT_READY' }
      }
      if (!fcraConsentOnFile(await findSignedDocuments(agencyId, caregiverId))) {
        return { ok: false, reason: 'FCRA_NOT_SIGNED' }
      }

      for (const step of path.steps.slice(0, -1)) {
        requireStatusChanged(await changeRequirementInstanceStatus(agencyId, check.instanceId, step), check.instanceId)
      }
      const checkResult = await createCheckResult(agencyId, caregiverId, principal.id)
      const link = await linkEvidence(agencyId, check.instanceId, BACKGROUND_CHECK_RESULT_EVIDENCE_KEY, {
        kind: 'CHECK_RESULT',
        checkResultId: checkResult.id,
      })
      if (!link.ok) {
        throw new Error(
          `Requirement instance ${check.instanceId} does not accept CHECK_RESULT ${BACKGROUND_CHECK_RESULT_EVIDENCE_KEY}.`,
        )
      }
      requireStatusChanged(
        await changeRequirementInstanceStatus(agencyId, check.instanceId, 'SATISFIED'),
        check.instanceId,
      )
      await applyVerificationCompleted(tx, agencyId, caregiverId, principal.id)

      const moved = await applyPipelineTransition(tx, agencyId, {
        caregiverId,
        event: 'CLEARANCE_GRANTED',
        actorUserId: principal.id,
      })
      if (!moved.ok) throw new Error(`Caregiver ${caregiverId} could not be cleared; a concurrent writer moved them.`)
      await writeAuditEntry(tx, { agencyId, action: 'SIGN_OFF', entityType: 'CAREGIVER', entityId: caregiverId })
      await recordCaregiverCredentials(agencyId, caregiverId, new Date())
      // ADR-166: the demo stops at Ready for AlayaCare; no sync is enqueued.
      await enqueueNudge(tx, agencyId, caregiverId, null, `cleared:${caregiverId}`)
      return { ok: true }
    })
  })
