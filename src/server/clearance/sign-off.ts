import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findClearanceSheet } from '@/db/repositories/clearance'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import { clearanceReadiness } from '@/domain/requirements/clearance'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { recordCaregiverCredentials } from '@/server/credentials/record-credentials'
import { ALAYACARE_SYNC_JOB_TYPE, type AlayaCareSyncPayload } from '@/server/sync/alayacare-sync-job'

export type SignOffResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NO_REQUIREMENTS' | 'BLOCKING_OUTSTANDING' | 'NOT_IN_CLEARANCE' }

const signOffInputSchema = z.object({ caregiverId: z.uuid() })

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
export const signOffClearance: UseCase<{ readonly caregiverId: string }, SignOffResult> = defineUseCase(
  'clearance.signOff',
  async ({ principal, input: raw }) => {
    const { caregiverId } = signOffInputSchema.parse(raw)
    const { agencyId } = principal
    const signedOffAt = new Date()

    return runInAuditedTransaction(async (tx): Promise<SignOffResult> => {
      const sheet = await findClearanceSheet(tx, agencyId, caregiverId)
      if (sheet === null) throw new Error(`Caregiver ${caregiverId} does not exist in agency ${agencyId}.`)

      const readiness = clearanceReadiness(sheet.requirements)
      if (!readiness.ready) return { ok: false, reason: readiness.reason }

      const moved = await applyPipelineTransition(tx, agencyId, {
        caregiverId,
        event: 'CLEARANCE_GRANTED',
        actorUserId: principal.id,
      })
      if (!moved.ok) return { ok: false, reason: 'NOT_IN_CLEARANCE' }

      await writeAuditEntry(tx, { agencyId, action: 'SIGN_OFF', entityType: 'CAREGIVER', entityId: caregiverId })
      // Credentials are recorded before the sync is queued, in this transaction (ADR-108).
      await recordCaregiverCredentials(agencyId, caregiverId, signedOffAt)
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: ALAYACARE_SYNC_JOB_TYPE,
        payload: { caregiverId } satisfies AlayaCareSyncPayload,
        idempotencyKey: buildIdempotencyKey(ALAYACARE_SYNC_JOB_TYPE, [caregiverId, 'CLEARANCE_GRANTED']),
      })
      return { ok: true }
    })
  },
)
