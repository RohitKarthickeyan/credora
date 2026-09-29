import { manualCheckPath } from '@/domain/requirements/manual-check'
import {
  TRAINING_EVIDENCE_KEYS,
  type TrainingCompletionFact,
  type TrainingRequirementFact,
  evaluateTrainingRequirement,
} from '@/domain/requirements/training-hours'
import type { TrainingImport } from '@/integrations/ports/training'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '../audit'
import { fromDateColumn, toDateColumn } from '../mapping/date-only'
import { prisma } from '../prisma'
import { type InstanceStatusChange, changeRequirementInstanceStatus, linkEvidence } from './requirement-instances'
import { applyVerificationCompleted } from './verification'

type Identity = { readonly legalFirstName: string | null; readonly legalLastName: string | null } | null

// IdentityRecord is sensitive-tier: only the two plaintext name columns are ever selected.
const IDENTITY_SELECT = { select: { legalFirstName: true, legalLastName: true } } as const

function nameOf(identity: Identity): string | null {
  const parts = [identity?.legalFirstName ?? null, identity?.legalLastName ?? null].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
}

const TRAINING_TEMPLATE_SELECT = {
  select: {
    minimumMinutes: true,
    acceptedEvidence: { where: { kind: 'TRAINING_RECORD' }, select: { evidenceKey: true } },
  },
} as const

function toRequirementFact(template: {
  readonly minimumMinutes: number | null
  readonly acceptedEvidence: readonly { readonly evidenceKey: string }[]
}): TrainingRequirementFact {
  return {
    minimumMinutes: template.minimumMinutes,
    trainingEvidenceKeys: template.acceptedEvidence.map(({ evidenceKey }) => evidenceKey),
  }
}

const COMPLETION_SELECT = { id: true, courseCode: true, completedOn: true, minutes: true } as const
const COMPLETION_ORDER = [{ completedOn: 'asc' }, { id: 'asc' }] as const

function toCompletionFact(row: {
  readonly id: string
  readonly courseCode: string
  readonly completedOn: Date
  readonly minutes: number
}): TrainingCompletionFact {
  return { ...row, completedOn: fromDateColumn(row.completedOn) }
}

// The path and the evidence key were both computed from what was just read, so a refusal is a
// concurrent writer or a programmer error.
function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}) while training completions were applied.`,
  )
}

type RecordTrainingImportResult = {
  readonly importId: string
  readonly addedCount: number
}

/**
 * One transaction: the import, its rejected rows, the completions not already held (attached to
 * a caregiver already linked by platform id), an EDIT audit entry per caregiver that gained one,
 * and applyTrainingRequirements for each such caregiver who is not withdrawn. The first import
 * of a completion wins (OPEN-QUESTIONS 249).
 */
export function recordTrainingImport(
  agencyId: string,
  batch: TrainingImport,
  importedAt: Date,
): Promise<RecordTrainingImportResult> {
  return runInAuditedTransaction(async (tx) => {
    const linked = await tx.caregiver.findMany({
      where: {
        agencyId,
        trainingPlatformId: { in: [...new Set(batch.records.map((record) => record.externalCaregiverId))] },
      },
      select: { id: true, stage: true, trainingPlatformId: true },
    })
    const caregiverIdOf = new Map(linked.map((caregiver) => [caregiver.trainingPlatformId, caregiver.id]))

    const added = await tx.trainingCompletion.createManyAndReturn({
      data: batch.records.map((record) => ({
        agencyId,
        externalCaregiverId: record.externalCaregiverId,
        caregiverId: caregiverIdOf.get(record.externalCaregiverId) ?? null,
        courseCode: record.courseCode,
        courseName: record.courseName,
        completedOn: toDateColumn(record.completedOn),
        minutes: record.minutes,
        importedAt,
      })),
      skipDuplicates: true,
      select: { caregiverId: true },
    })

    const created = await tx.trainingImport.create({
      data: {
        agencyId,
        sourceRef: batch.sourceRef,
        importedAt,
        recordCount: batch.records.length,
        addedCount: added.length,
        rejections: { createMany: { data: batch.rejected.map(({ line, reason }) => ({ line, reason })) } },
      },
      select: { id: true },
    })

    const gained = new Set(added.map((completion) => completion.caregiverId))
    for (const caregiver of linked) {
      if (!gained.has(caregiver.id)) continue
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: caregiver.id,
        fieldName: 'trainingCompletions',
      })
      if (caregiver.stage !== 'WITHDRAWN') {
        await applyTrainingRequirements(tx, agencyId, caregiver.id, importedAt, null)
      }
    }

    return { importId: created.id, addedCount: added.length }
  })
}

/**
 * Evaluates every TRAINING instance of one caregiver against their completions and satisfies
 * each one met, against the minimum pinned on the instance's own template version (ADR-055).
 * A SATISFIED or WAIVED instance is left alone; a shortfall writes nothing.
 */
async function applyTrainingRequirements(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  asOf: Date,
  actorUserId: string | null,
): Promise<void> {
  const instances = await tx.requirementInstance.findMany({
    where: { agencyId, caregiverId, template: { type: 'TRAINING' } },
    orderBy: { templateKey: 'asc' },
    select: {
      id: true,
      status: true,
      template: TRAINING_TEMPLATE_SELECT,
      evidence: { select: { trainingCompletionId: true } },
    },
  })
  const completions = (
    await tx.trainingCompletion.findMany({
      where: { agencyId, caregiverId },
      orderBy: [...COMPLETION_ORDER],
      select: COMPLETION_SELECT,
    })
  ).map(toCompletionFact)

  let satisfiedAny = false
  for (const instance of instances) {
    const standing = evaluateTrainingRequirement(toRequirementFact(instance.template), completions, asOf)
    if (standing === null || !standing.met) continue
    const path = manualCheckPath(instance.status)
    if (!path.ok) continue

    const evidenceKey = TRAINING_EVIDENCE_KEYS[standing.category]
    const alreadyLinked = new Set(instance.evidence.map((evidence) => evidence.trainingCompletionId))
    for (const trainingCompletionId of standing.countedCompletionIds) {
      if (alreadyLinked.has(trainingCompletionId)) continue
      const link = await linkEvidence(agencyId, instance.id, evidenceKey, {
        kind: 'TRAINING_RECORD',
        trainingCompletionId,
      })
      if (!link.ok) {
        throw new Error(`Requirement instance ${instance.id} does not accept TRAINING_RECORD ${evidenceKey}.`)
      }
    }
    for (const step of path.steps) {
      requireChanged(await changeRequirementInstanceStatus(agencyId, instance.id, step), instance.id)
    }
    satisfiedAny = true
  }

  if (satisfiedAny) await applyVerificationCompleted(tx, agencyId, caregiverId, actorUserId)
}

export type TrainingAccountLinkResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'CAREGIVER_NOT_FOUND' | 'CAREGIVER_WITHDRAWN' | 'ALREADY_LINKED' | 'ID_TAKEN'
    }

/**
 * Sets the caregiver's training platform id, attaches every completion held under it, credits
 * them (applyTrainingRequirements) and writes one EDIT audit entry, in one transaction. A
 * refusal writes nothing.
 */
export function linkTrainingPlatformId(
  agencyId: string,
  caregiverId: string,
  externalCaregiverId: string,
  asOf: Date,
  actorUserId: string,
): Promise<TrainingAccountLinkResult> {
  return runInAuditedTransaction(async (tx): Promise<TrainingAccountLinkResult> => {
    const caregiver = await tx.caregiver.findFirst({
      where: { agencyId, id: caregiverId },
      select: { stage: true, trainingPlatformId: true },
    })
    if (caregiver === null) return { ok: false, reason: 'CAREGIVER_NOT_FOUND' }
    if (caregiver.stage === 'WITHDRAWN') return { ok: false, reason: 'CAREGIVER_WITHDRAWN' }
    if (caregiver.trainingPlatformId !== null) return { ok: false, reason: 'ALREADY_LINKED' }
    const holder = await tx.caregiver.findFirst({
      where: { agencyId, trainingPlatformId: externalCaregiverId },
      select: { id: true },
    })
    if (holder !== null) return { ok: false, reason: 'ID_TAKEN' }

    await tx.caregiver.update({
      where: { agencyId_id: { agencyId, id: caregiverId } },
      data: { trainingPlatformId: externalCaregiverId },
    })
    await tx.trainingCompletion.updateMany({
      where: { agencyId, externalCaregiverId, caregiverId: null },
      data: { caregiverId },
    })
    await applyTrainingRequirements(tx, agencyId, caregiverId, asOf, actorUserId)
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'CAREGIVER',
      entityId: caregiverId,
      fieldName: 'trainingPlatformId',
    })
    return { ok: true }
  })
}

type TrainingHoursSubject = {
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly requirements: readonly (TrainingRequirementFact & { readonly name: string })[]
  readonly completions: readonly TrainingCompletionFact[]
}

const WITH_MINIMUM = { type: 'TRAINING', minimumMinutes: { not: null } } as const

export async function findTrainingHoursSubjects(agencyId: string): Promise<readonly TrainingHoursSubject[]> {
  const rows = await prisma.caregiver.findMany({
    where: {
      agencyId,
      stage: { not: 'WITHDRAWN' },
      requirementInstances: { some: { template: WITH_MINIMUM } },
    },
    select: {
      id: true,
      identity: IDENTITY_SELECT,
      requirementInstances: {
        where: { template: WITH_MINIMUM },
        orderBy: { templateKey: 'asc' },
        select: { template: { select: { name: true, ...TRAINING_TEMPLATE_SELECT.select } } },
      },
      trainingCompletions: { orderBy: [...COMPLETION_ORDER], select: COMPLETION_SELECT },
    },
  })
  return rows.map((row) => ({
    caregiverId: row.id,
    caregiverName: nameOf(row.identity),
    requirements: row.requirementInstances.map(({ template }) => ({
      name: template.name,
      ...toRequirementFact(template),
    })),
    completions: row.trainingCompletions.map(toCompletionFact),
  }))
}

export type UnmatchedTrainingAccount = {
  readonly externalCaregiverId: string
  readonly completions: number
  readonly minutes: number
}

export async function findUnmatchedTrainingAccounts(agencyId: string): Promise<readonly UnmatchedTrainingAccount[]> {
  const groups = await prisma.trainingCompletion.groupBy({
    by: ['externalCaregiverId'],
    where: { agencyId, caregiverId: null },
    orderBy: { externalCaregiverId: 'asc' },
    _count: { _all: true },
    _sum: { minutes: true },
  })
  return groups.map((group) => ({
    externalCaregiverId: group.externalCaregiverId,
    completions: group._count._all,
    minutes: group._sum.minutes ?? 0,
  }))
}

export type LinkableCaregiver = { readonly caregiverId: string; readonly caregiverName: string | null }

export async function findLinkableCaregivers(agencyId: string): Promise<readonly LinkableCaregiver[]> {
  const rows = await prisma.caregiver.findMany({
    where: { agencyId, stage: { not: 'WITHDRAWN' }, trainingPlatformId: null },
    select: { id: true, identity: IDENTITY_SELECT },
  })
  return rows.map((row) => ({ caregiverId: row.id, caregiverName: nameOf(row.identity) }))
}

export type TrainingCourse = {
  readonly courseCode: string
  readonly courseName: string
  readonly completions: number
}

export async function findTrainingCourses(agencyId: string): Promise<readonly TrainingCourse[]> {
  const groups = await prisma.trainingCompletion.groupBy({
    by: ['courseCode', 'courseName'],
    where: { agencyId },
    orderBy: [{ courseCode: 'asc' }, { courseName: 'asc' }],
    _count: { _all: true },
  })
  return groups.map((group) => ({
    courseCode: group.courseCode,
    courseName: group.courseName,
    completions: group._count._all,
  }))
}

export type TrainingImportSummary = {
  readonly id: string
  readonly sourceRef: string
  readonly importedAt: Date
  readonly recordCount: number
  readonly addedCount: number
  readonly rejected: readonly { readonly line: number; readonly reason: string }[]
}

export async function findRecentTrainingImports(
  agencyId: string,
  limit: number,
): Promise<readonly TrainingImportSummary[]> {
  const rows = await prisma.trainingImport.findMany({
    where: { agencyId },
    orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      sourceRef: true,
      importedAt: true,
      recordCount: true,
      addedCount: true,
      rejections: { orderBy: { line: 'asc' }, select: { line: true, reason: true } },
    },
  })
  return rows.map(({ rejections, ...row }) => ({ ...row, rejected: rejections }))
}
