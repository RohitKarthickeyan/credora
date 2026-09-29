import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { ManualCheckRow } from '@/domain/requirements/manual-check'
import { runInAuditedTransaction } from '../audit'

const TEMPLATE_SELECT = {
  name: true,
  manualOnly: true,
  manualOnlyReason: true,
  acceptedEvidence: { select: { kind: true, evidenceKey: true, label: true } },
} as const

function toTemplate(template: ManualCheckRow['template']): ManualCheckRow['template'] {
  return {
    name: template.name,
    manualOnly: template.manualOnly,
    manualOnlyReason: template.manualOnlyReason,
    acceptedEvidence: template.acceptedEvidence.map(({ kind, evidenceKey, label }) => ({
      kind,
      evidenceKey,
      label,
    })),
  }
}

// Every non-withdrawn instance, not only manual-only ones: satisfactionPath is the one reader of
// manualOnly, so the domain filters. IdentityRecord is sensitive-tier: only the two plaintext
// name columns are selected.
export function findManualCheckRows(agencyId: string): Promise<readonly ManualCheckRow[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, caregiver: { stage: { not: 'WITHDRAWN' } } },
      select: {
        id: true,
        caregiverId: true,
        status: true,
        template: { select: TEMPLATE_SELECT },
        caregiver: {
          select: {
            identity: { select: { legalFirstName: true, legalLastName: true } },
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
        template: toTemplate(row.template),
      }
    })
  })
}

type ManualCheckSubject = {
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly status: InstanceStatus
  readonly template: ManualCheckRow['template']
}

export function findManualCheckSubject(
  agencyId: string,
  instanceId: string,
): Promise<ManualCheckSubject | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.requirementInstance.findUnique({
      where: { agencyId_id: { agencyId, id: instanceId } },
      select: {
        caregiverId: true,
        status: true,
        template: { select: TEMPLATE_SELECT },
        caregiver: { select: { stage: true } },
      },
    })
    if (row === null) return null

    return {
      caregiverId: row.caregiverId,
      caregiverStage: row.caregiver.stage,
      status: row.status,
      template: toTemplate(row.template),
    }
  })
}
