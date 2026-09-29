import type { PipelineStage } from '@/domain/pipeline/stage'
import type { BlockerCandidate } from '@/domain/requirements/blocker'
import { prisma } from '../prisma'

export type PipelineBoardRow = {
  readonly caregiverId: string
  readonly stage: PipelineStage
  readonly createdAt: Date
  readonly lastTransitionAt: Date | null
  readonly legalFirstName: string | null
  readonly legalLastName: string | null
  readonly instances: readonly BlockerCandidate[]
}

// IdentityRecord is sensitive-tier: only the two plaintext name columns are selected, never an
// encrypted one.
export async function findPipelineBoardRows(
  agencyId: string,
  stages: readonly PipelineStage[],
): Promise<readonly PipelineBoardRow[]> {
  const rows = await prisma.caregiver.findMany({
    where: { agencyId, stage: { in: [...stages] } },
    select: {
      id: true,
      stage: true,
      createdAt: true,
      identity: { select: { legalFirstName: true, legalLastName: true } },
      pipelineEvents: {
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { occurredAt: true },
      },
      requirementInstances: {
        select: {
          templateKey: true,
          status: true,
          template: { select: { name: true, blocksClearance: true } },
        },
      },
    },
  })

  return rows.map((row) => ({
    caregiverId: row.id,
    stage: row.stage,
    createdAt: row.createdAt,
    lastTransitionAt: row.pipelineEvents[0]?.occurredAt ?? null,
    legalFirstName: row.identity?.legalFirstName ?? null,
    legalLastName: row.identity?.legalLastName ?? null,
    instances: row.requirementInstances.map((instance) => ({
      templateKey: instance.templateKey,
      status: instance.status,
      name: instance.template.name,
      blocksClearance: instance.template.blocksClearance,
    })),
  }))
}
