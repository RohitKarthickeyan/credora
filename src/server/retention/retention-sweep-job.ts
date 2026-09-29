import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import {
  deleteAuditEntriesBefore,
  deleteBackgroundCheckOrder,
  deleteInboundWebhooksBefore,
  deleteInvitedCaregiver,
  findCaregiverForDeletion,
  listBackgroundCheckOrdersBefore,
  listDisposableUnsignedPdfs,
  listNeverStartedCandidates,
  markUnsignedPdfDeleted,
} from '@/db/repositories/retention'
import { deleteEeocRecord } from '@/db/restricted/eeoc'
import { deleteMedicalFile } from '@/db/restricted/medical'
import {
  DISPOSABLE_ENVELOPE_STATUSES,
  i9Retention,
  neverStartedApplicantDue,
  retentionCutoff,
} from '@/domain/retention/rules'
import type { StoragePort } from '@/integrations/ports/storage'
import type { JobContext, JobOutcome } from '@/integrations/queue/handler'
import { defineJobHandler } from '@/integrations/queue/handler'
import { stopSchedule } from '@/integrations/queue/schedule'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'

export const RETENTION_SWEEP_JOB_TYPE = 'retention.sweep'

// Per pass per occurrence; the rest wait a day.
const RETENTION_BATCH_LIMIT = 100

// Duplicated from reference-jobs.ts and background-check-jobs.ts, which export no key helper.
const chaseScheduleKey = (referenceId: string) => `reference.chase:${referenceId}`
const pollScheduleKey = (orderId: string) => `backgroundCheck.poll:${orderId}`

/**
 * Rows first, then bytes and schedules (ADR-157): the stage guard may refuse inside the
 * transaction, and deleting bytes first would destroy a live applicant's files on that race.
 * deleteMedicalFile and deleteEeocRecord join the open transaction, so core and restricted rows
 * go together or not at all (DATA-MODEL invariant 3).
 */
async function deleteNeverStartedApplicants(storage: StoragePort, { agencyId, now }: JobContext): Promise<void> {
  const cutoff = retentionCutoff('NEVER_STARTED_APPLICANT', now)
  for (const candidate of await listNeverStartedCandidates(agencyId, cutoff, RETENTION_BATCH_LIMIT)) {
    if (!neverStartedApplicantDue({ ...candidate, now })) continue
    const { caregiverId } = candidate

    const deleted = await runInAuditedTransaction(async (tx) => {
      const caregiver = await findCaregiverForDeletion(tx, agencyId, caregiverId)
      if (caregiver === null || caregiver.stage !== 'INVITED') return null
      if (i9Retention({ hiredAt: caregiver.hiredAt, terminatedAt: null }).kind !== 'NOT_HIRED') return null
      if (!(await deleteInvitedCaregiver(tx, agencyId, caregiverId))) return null

      await deleteMedicalFile(agencyId, caregiverId)
      await deleteEeocRecord(agencyId, caregiverId)
      await writeAuditEntry(tx, {
        agencyId,
        action: 'DELETE',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
        reason: 'retention NEVER_STARTED_APPLICANT',
      })
      return caregiver
    })
    if (deleted === null) continue

    for (const key of deleted.storageKeys) await storage.delete(agencyId, key)
    for (const referenceId of deleted.referenceIds) await stopSchedule(agencyId, chaseScheduleKey(referenceId), now)
    if (deleted.backgroundCheckOrderId !== null) {
      await stopSchedule(agencyId, pollScheduleKey(deleted.backgroundCheckOrderId), now)
    }
  }
}

// Bytes first: the envelope is terminal or the caregiver withdrew, so nothing can need the file
// again, and a crash between the two re-runs as a delete of nothing plus the stamp (ADR-157).
async function deleteUnsignedPdfs(storage: StoragePort, { agencyId, now }: JobContext): Promise<void> {
  for (const pdf of await listDisposableUnsignedPdfs(agencyId, DISPOSABLE_ENVELOPE_STATUSES, RETENTION_BATCH_LIMIT)) {
    await storage.delete(agencyId, pdf.unsignedPdfKey)
    await runInAuditedTransaction(async (tx) => {
      if (!(await markUnsignedPdfDeleted(tx, agencyId, pdf.envelopeDocumentId, now))) return
      await writeAuditEntry(tx, {
        agencyId,
        action: 'DELETE',
        entityType: 'CAREGIVER',
        entityId: pdf.caregiverId,
        fieldName: 'unsignedPdfKey',
        reason: 'retention UNSIGNED_GENERATED_PDF',
      })
    })
  }
}

// The vendor-reported CheckResult is kept: it holds no result detail, and deleting it would
// rewrite clearance history.
async function deleteBackgroundCheckOrders({ agencyId, now }: JobContext): Promise<void> {
  const cutoff = retentionCutoff('BACKGROUND_CHECK_RESULT', now)
  for (const order of await listBackgroundCheckOrdersBefore(agencyId, cutoff, RETENTION_BATCH_LIMIT)) {
    const deleted = await runInAuditedTransaction(async (tx) => {
      if (!(await deleteBackgroundCheckOrder(tx, agencyId, order.orderId, order.vendorOrderId))) return false
      await writeAuditEntry(tx, {
        agencyId,
        action: 'DELETE',
        entityType: 'CAREGIVER',
        entityId: order.caregiverId,
        fieldName: 'backgroundCheckOrder',
        reason: 'retention BACKGROUND_CHECK_RESULT',
      })
      return true
    })
    if (deleted) await stopSchedule(agencyId, pollScheduleKey(order.orderId), now)
  }
}

const WEBHOOK_RULES = [
  ['backgroundCheck', 'BACKGROUND_CHECK_WEBHOOK'],
  ['esign', 'ESIGN_WEBHOOK'],
] as const

async function deleteInboundWebhooks({ agencyId, now }: JobContext): Promise<void> {
  for (const [provider, rule] of WEBHOOK_RULES) {
    await runInAuditedTransaction(async (tx) => {
      for (const id of await deleteInboundWebhooksBefore(tx, agencyId, provider, retentionCutoff(rule, now))) {
        await writeAuditEntry(tx, {
          agencyId,
          action: 'DELETE',
          entityType: 'INBOUND_WEBHOOK',
          entityId: id,
          reason: `retention ${rule}`,
        })
      }
    })
  }
}

// Last, in its own short transaction: it locks AuditEntry exclusively (ADR-156).
async function deleteAuditEntries({ agencyId, now }: JobContext): Promise<void> {
  await runInAuditedTransaction(async (tx) => {
    const count = await deleteAuditEntriesBefore(tx, agencyId, retentionCutoff('AUDIT_LOG', now))
    if (count === 0) return
    await writeAuditEntry(tx, {
      agencyId,
      action: 'DELETE',
      entityType: 'AUDIT_LOG',
      entityId: agencyId,
      reason: `retention AUDIT_LOG: ${count} entries`,
    })
  })
}

function runRetentionSweep(storage: StoragePort, context: JobContext): Promise<JobOutcome> {
  return runAsSystem(async () => {
    await deleteNeverStartedApplicants(storage, context)
    await deleteUnsignedPdfs(storage, context)
    await deleteBackgroundCheckOrders(context)
    await deleteInboundWebhooks(context)
    await deleteAuditEntries(context)
    return { status: 'ok' }
  })
}

/** SECURITY.md § Retention: once a day per agency, under the system actor (ADR-155). */
export const retentionSweepJob = defineJobHandler({
  type: RETENTION_SWEEP_JOB_TYPE,
  schema: z.strictObject({}),
  run: (_payload, context) => runRetentionSweep(getPort('storage'), context),
})
