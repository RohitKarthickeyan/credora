import type { PipelineStage } from '@/domain/pipeline/stage'
import { CHRC_REQUIREMENT_KEY, type ChrcRow } from '@/domain/requirements/chrc'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { runInAuditedTransaction } from '../audit'

// IdentityRecord is sensitive-tier: only the two plaintext name columns are selected.
export function findChrcRows(agencyId: string): Promise<readonly ChrcRow[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, templateKey: CHRC_REQUIREMENT_KEY, caregiver: { stage: { not: 'WITHDRAWN' } } },
      select: {
        id: true,
        caregiverId: true,
        status: true,
        caregiver: {
          select: {
            identity: { select: { legalFirstName: true, legalLastName: true } },
            chrcSubmission: { select: { submittedAt: true } },
          },
        },
      },
    })

    return rows.map((row) => {
      const nameParts = [
        row.caregiver.identity?.legalFirstName ?? null,
        row.caregiver.identity?.legalLastName ?? null,
      ].filter((part) => part !== null)
      return {
        instanceId: row.id,
        caregiverId: row.caregiverId,
        caregiverName: nameParts.length === 0 ? null : nameParts.join(' '),
        status: row.status,
        submittedAt: row.caregiver.chrcSubmission?.submittedAt ?? null,
      }
    })
  })
}

type ChrcSubject = {
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly status: InstanceStatus
  readonly submitted: boolean
}

export function findChrcSubject(agencyId: string, instanceId: string): Promise<ChrcSubject | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.requirementInstance.findFirst({
      where: { agencyId, id: instanceId, templateKey: CHRC_REQUIREMENT_KEY },
      select: {
        caregiverId: true,
        status: true,
        caregiver: { select: { stage: true, chrcSubmission: { select: { id: true } } } },
      },
    })
    if (row === null) return null

    return {
      caregiverId: row.caregiverId,
      caregiverStage: row.caregiver.stage,
      status: row.status,
      submitted: row.caregiver.chrcSubmission !== null,
    }
  })
}

export function createChrcSubmission(
  agencyId: string,
  caregiverId: string,
  submittedByUserId: string,
): Promise<void> {
  return runInAuditedTransaction(async (tx) => {
    await tx.chrcSubmission.create({ data: { agencyId, caregiverId, submittedByUserId } })
  })
}
