import {
  type CaregiverNoticeStatus,
  type DecisionTarget,
  type NoticeTarget,
  RETURN_DECISIONS,
  type StaffDecision,
} from '@/domain/documents/staff-decision'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { AuditedTx } from '../audit'

type Upload = { readonly id: string; readonly uploadedAt: Date }

function isLater(a: Upload, b: Upload): boolean {
  const diff = a.uploadedAt.getTime() - b.uploadedAt.getTime()
  return diff !== 0 ? diff > 0 : a.id > b.id
}

/** null: not this agency's document, or not evidence on that instance. */
export async function findDecisionTarget(
  tx: AuditedTx,
  agencyId: string,
  ids: { readonly instanceId: string; readonly uploadedDocumentId: string },
): Promise<(DecisionTarget & { readonly caregiverId: string; readonly templateKey: string }) | null> {
  const { instanceId, uploadedDocumentId } = ids
  const row = await tx.uploadedDocument.findFirst({
    where: { id: uploadedDocumentId, agencyId, evidence: { some: { instanceId } } },
    select: {
      id: true,
      uploadedAt: true,
      caregiver: { select: { id: true, stage: true } },
      autoAcceptDecision: { select: { instanceStatusSet: true } },
      staffDecision: { select: { id: true } },
      evidence: {
        where: { instanceId },
        select: {
          instance: {
            select: {
              status: true,
              templateKey: true,
              evidence: {
                where: { kind: 'UPLOADED_DOCUMENT' },
                select: { uploadedDocument: { select: { id: true, uploadedAt: true } } },
              },
            },
          },
        },
      },
    },
  })
  const instance = row?.evidence[0]?.instance
  if (row === null || instance === undefined) return null

  return {
    caregiverId: row.caregiver.id,
    templateKey: instance.templateKey,
    stage: row.caregiver.stage,
    instanceStatus: instance.status,
    flagged: row.autoAcceptDecision?.instanceStatusSet === 'EXCEPTION',
    decided: row.staffDecision !== null,
    latestUpload: !instance.evidence.some(
      ({ uploadedDocument }) => uploadedDocument !== null && isLater(uploadedDocument, row),
    ),
  }
}

/** Never catches the unique conflict: a second decision on one document fails the unit of work. */
export async function saveStaffDocumentDecision(
  tx: AuditedTx,
  agencyId: string,
  input: { readonly uploadedDocumentId: string; readonly decision: StaffDecision; readonly decidedByUserId: string },
): Promise<{ readonly id: string }> {
  const returned = (RETURN_DECISIONS as readonly StaffDecision[]).includes(input.decision)
  return tx.staffDocumentDecision.create({
    data: { agencyId, ...input, caregiverNotice: returned ? 'QUEUED' : null },
    select: { id: true },
  })
}

export async function findWaiverTarget(
  tx: AuditedTx,
  agencyId: string,
  instanceId: string,
): Promise<{ readonly caregiverId: string; readonly stage: PipelineStage; readonly instanceStatus: InstanceStatus } | null> {
  const row = await tx.requirementInstance.findFirst({
    where: { id: instanceId, agencyId },
    select: { caregiverId: true, status: true, caregiver: { select: { stage: true } } },
  })
  return row === null ? null : { caregiverId: row.caregiverId, stage: row.caregiver.stage, instanceStatus: row.status }
}

/** The caller has just moved the instance to WAIVED in this transaction. */
export async function recordRequirementWaiver(
  tx: AuditedTx,
  agencyId: string,
  instanceId: string,
  waivedByUserId: string,
): Promise<void> {
  const { count } = await tx.requirementInstance.updateMany({
    where: { id: instanceId, agencyId, status: 'WAIVED' },
    data: { waivedByUserId, waivedAt: new Date() },
  })
  if (count === 0) throw new Error(`Requirement instance ${instanceId} is not WAIVED, so no waiver was recorded.`)
}

type CaregiverNoticeForSend = NoticeTarget & {
  readonly notice: CaregiverNoticeStatus | null
  readonly decision: StaffDecision
  readonly agencyName: string
}

export async function findCaregiverNoticeForSend(
  tx: AuditedTx,
  agencyId: string,
  staffDecisionId: string,
): Promise<CaregiverNoticeForSend | null> {
  const row = await tx.staffDocumentDecision.findFirst({
    where: { id: staffDecisionId, agencyId },
    select: {
      caregiverNotice: true,
      decision: true,
      uploadedDocument: {
        select: {
          id: true,
          caregiver: {
            select: {
              stage: true,
              contact: { select: { email: true } },
              agency: { select: { name: true } },
            },
          },
          evidence: { select: { instance: { select: { status: true } } } },
        },
      },
    },
  })
  if (row === null) return null
  const { caregiver, evidence } = row.uploadedDocument
  const link = evidence[0]
  if (link === undefined) throw new Error(`Uploaded document ${row.uploadedDocument.id} is evidence on no instance (T-070).`)

  return {
    notice: row.caregiverNotice,
    decision: row.decision,
    stage: caregiver.stage,
    instanceStatus: link.instance.status,
    email: caregiver.contact?.email ?? null,
    agencyName: caregiver.agency.name,
  }
}

/** Settles a QUEUED notice exactly once; false when it had already left QUEUED. */
export async function recordCaregiverNoticeOutcome(
  tx: AuditedTx,
  agencyId: string,
  staffDecisionId: string,
  status: Exclude<CaregiverNoticeStatus, 'QUEUED'>,
  now: Date,
): Promise<boolean> {
  const { count } = await tx.staffDocumentDecision.updateMany({
    where: { id: staffDecisionId, agencyId, caregiverNotice: 'QUEUED' },
    data: { caregiverNotice: status, noticeSettledAt: now },
  })
  return count === 1
}
