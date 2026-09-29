import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { type AuditedTx, runInAuditedTransaction } from '../audit'
import { toDateColumn } from '../mapping/date-only'

export type HealthScreeningSubject = {
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly templateKey: string
  readonly status: InstanceStatus
}

export function findHealthScreeningSubject(
  agencyId: string,
  instanceId: string,
): Promise<HealthScreeningSubject | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.requirementInstance.findFirst({
      where: { agencyId, id: instanceId },
      select: { caregiverId: true, templateKey: true, status: true, caregiver: { select: { stage: true } } },
    })
    if (row === null) return null

    return {
      caregiverId: row.caregiverId,
      caregiverStage: row.caregiver.stage,
      templateKey: row.templateKey,
      status: row.status,
    }
  })
}

/** The caller has just moved the instance to SATISFIED in this transaction. */
export async function recordPassingResultDate(
  tx: AuditedTx,
  agencyId: string,
  instanceId: string,
  resultedOn: string,
): Promise<void> {
  const { count } = await tx.requirementInstance.updateMany({
    where: { id: instanceId, agencyId, status: 'SATISFIED' },
    data: { resultedOn: toDateColumn(resultedOn) },
  })
  if (count === 0) throw new Error(`Requirement instance ${instanceId} is not SATISFIED, so no result date was recorded.`)
}
