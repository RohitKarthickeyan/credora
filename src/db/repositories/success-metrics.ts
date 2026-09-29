import { type ReportWindow, STAFF_RETYPED_FIELDS, type SuccessMetricsFacts } from '@/domain/reports/success-metrics'
import { prisma } from '../prisma'

// Every select names its columns and none names `reason`: a withdrawal reason is staff free text
// that may hold a medical reason. Caregiver ids stay inside this function.
export async function readSuccessMetricsFacts(agencyId: string, window: ReportWindow): Promise<SuccessMetricsFacts> {
  const inWindow = { gte: window.start, lt: window.end }

  const clearances = await prisma.pipelineEvent.findMany({
    where: { agencyId, event: 'CLEARANCE_GRANTED', occurredAt: inWindow },
    select: { caregiverId: true, occurredAt: true, caregiver: { select: { createdAt: true } } },
  })

  const starts = await prisma.pipelineEvent.findMany({
    where: { agencyId, event: 'INTAKE_STARTED', occurredAt: inWindow },
    select: { caregiver: { select: { stage: true, pipelineEvents: { select: { event: true } } } } },
  })

  const retypedFields =
    clearances.length === 0
      ? 0
      : await prisma.auditEntry.count({
          where: {
            agencyId,
            action: 'EDIT',
            entityType: 'CAREGIVER',
            actorRole: { in: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN', 'IMPLEMENTATION'] },
            fieldName: { in: [...STAFF_RETYPED_FIELDS] },
            entityId: { in: clearances.map((row) => row.caregiverId) },
          },
        })

  const decided = await prisma.autoAcceptDecision.count({
    where: { agencyId, instanceStatusSet: { not: null }, decidedAt: inWindow },
  })
  const autoAccepted = await prisma.autoAcceptDecision.count({
    where: { agencyId, staffReasons: { isEmpty: true }, instanceStatusSet: 'SATISFIED', decidedAt: inWindow },
  })

  const syncs = await prisma.alayaCareSync.findMany({
    where: { agencyId, status: { not: 'RUNNING' }, finishedAt: inWindow },
    select: { jobId: true, status: true },
  })
  const firstAttempts = await prisma.jobAttempt.groupBy({
    by: ['jobId'],
    where: { agencyId, jobId: { in: syncs.map((sync) => sync.jobId) }, attempt: 1 },
    _count: { _all: true },
  })
  const runsByJob = new Map(firstAttempts.map((row) => [row.jobId, row._count._all]))

  return {
    clearances: clearances.map((row) => ({ invitedAt: row.caregiver.createdAt, clearedAt: row.occurredAt })),
    paperworkStarts: starts.map(({ caregiver }) => ({
      stage: caregiver.stage,
      events: caregiver.pipelineEvents.map((row) => row.event),
    })),
    retypedFields,
    autoAccept: { decided, autoAccepted },
    finishedSyncs: syncs.flatMap(({ jobId, status }) =>
      status === 'RUNNING' ? [] : [{ status, runs: runsByJob.get(jobId) ?? 0 }],
    ),
  }
}
