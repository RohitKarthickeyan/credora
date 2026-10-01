import { isAcceptedEvidence } from '@/domain/requirements/accepted-evidence'
import {
  type InstanceStatus,
  type InstanceTransitionRefusal,
  transitionInstanceStatus,
} from '@/domain/requirements/instance-status'
import {
  type ResolutionContext,
  type TemplateAmbiguity,
  resolveRequirements,
} from '@/domain/requirements/resolve'
import { caregiverRoleOf } from '@/domain/requirements/role'
import { scopeKeyOf } from '@/domain/requirements/scope'
import { runInAuditedTransaction } from '../audit'
import type { RequirementInstanceModel } from '../generated/models/RequirementInstance'
import { type StoredRequirementTemplate, findLiveRequirementTemplates } from './requirement-templates'

export type StoredRequirementInstance = {
  readonly id: string
  readonly caregiverId: string
  readonly templateId: string
  readonly templateKey: string
  readonly status: InstanceStatus
}

export type MaterialisationResult =
  | { readonly ok: true; readonly instances: readonly StoredRequirementInstance[] }
  | {
      readonly ok: false
      readonly ambiguities: readonly TemplateAmbiguity<StoredRequirementTemplate>[]
    }

export type InstanceStatusChange =
  | { readonly ok: true; readonly instance: StoredRequirementInstance }
  | {
      readonly ok: false
      readonly from: InstanceStatus
      readonly to: InstanceStatus
      readonly refusal: InstanceTransitionRefusal
    }

/** For a caller that has just read the status: a refusal means a concurrent writer moved it. */
export function requireStatusChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok || (change.to === 'PENDING' && change.refusal === 'ALREADY_IN_STATUS')) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

export type EvidenceSource =
  | { readonly kind: 'SIGNED_DOCUMENT'; readonly signedDocumentId: string }
  | { readonly kind: 'UPLOADED_DOCUMENT'; readonly uploadedDocumentId: string }
  | { readonly kind: 'ATTESTATION'; readonly attestationId: string }
  | { readonly kind: 'CHECK_RESULT'; readonly checkResultId: string }
  | { readonly kind: 'TRAINING_RECORD'; readonly trainingCompletionId: string }

export type StoredEvidence = {
  readonly id: string
  readonly instanceId: string
  readonly evidenceKey: string
  readonly source: EvidenceSource
  readonly linkedAt: Date
}

export type EvidenceLinkResult =
  | { readonly ok: true; readonly evidence: StoredEvidence }
  | { readonly ok: false; readonly refusal: 'NOT_ACCEPTED' }

function toStoredInstance(row: RequirementInstanceModel): StoredRequirementInstance {
  return {
    id: row.id,
    caregiverId: row.caregiverId,
    templateId: row.templateId,
    templateKey: row.templateKey,
    status: row.status,
  }
}

function notFound(agencyId: string, instanceId: string): Error {
  return new Error(`Requirement instance ${instanceId} does not exist in agency ${agencyId}.`)
}

/**
 * The caregiver's resolution context: the ADR-072 hire facts plus the role derived from the
 * home-care profile (ADR-137). Null when workState or serviceType is not set. Reads through the
 * transaction so that, inside a profile save, it sees the certifications just written.
 */
export function findResolutionContext(
  agencyId: string,
  caregiverId: string,
): Promise<ResolutionContext | null> {
  return runInAuditedTransaction(async (tx) => {
    const caregiver = await tx.caregiver.findFirst({
      where: { id: caregiverId, agencyId },
      select: {
        workState: true,
        serviceType: true,
        payer: true,
        homeCareProfile: { select: { certificationsHeld: true } },
      },
    })
    if (caregiver === null || caregiver.workState === null || caregiver.serviceType === null) {
      return null
    }
    return {
      state: caregiver.workState,
      serviceType: caregiver.serviceType,
      payer: caregiver.payer,
      role: caregiverRoleOf(caregiver.homeCareProfile?.certificationsHeld ?? []),
    }
  })
}

/**
 * Insert-only for template publishes: an existing instance keeps the template version it was
 * materialised on (OPEN-QUESTIONS #16). On a context change, an untouched instance (NOT_STARTED,
 * no evidence, no credential) is re-pointed to the winner at a different scope (ADR-138); a
 * touched one keeps its rule. Never removes: one whose key no longer resolves stays (#37). An
 * ambiguous resolution writes nothing: a partial set would silently drop a rule.
 */
export function materialiseRequirementInstances(
  agencyId: string,
  caregiverId: string,
  context: ResolutionContext,
): Promise<MaterialisationResult> {
  return runInAuditedTransaction(async (tx) => {
    const resolution = resolveRequirements(
      agencyId,
      context,
      await findLiveRequirementTemplates(agencyId, context),
    )
    if (!resolution.ok) return { ok: false, ambiguities: resolution.ambiguities }

    const existing = await tx.requirementInstance.findMany({
      where: { agencyId, caregiverId },
      select: {
        id: true,
        templateKey: true,
        template: {
          select: { state: true, serviceType: true, payer: true, agencyId: true, role: true },
        },
      },
    })
    const existingByKey = new Map(existing.map((instance) => [instance.templateKey, instance]))

    for (const winner of resolution.requirements) {
      const instance = existingByKey.get(winner.key)
      if (instance === undefined || scopeKeyOf(instance.template) === scopeKeyOf(winner.scope)) {
        continue
      }
      await tx.requirementInstance.updateMany({
        where: {
          id: instance.id,
          agencyId,
          status: 'NOT_STARTED',
          evidence: { none: {} },
          credential: null,
        },
        data: { templateId: winner.id },
      })
    }

    await tx.requirementInstance.createMany({
      data: resolution.requirements.map((template) => ({
        agencyId,
        caregiverId,
        templateId: template.id,
        templateKey: template.key,
      })),
      skipDuplicates: true,
    })

    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, caregiverId },
      orderBy: { templateKey: 'asc' },
    })
    return { ok: true, instances: rows.map(toStoredInstance) }
  })
}

export function findRequirementInstances(
  agencyId: string,
  caregiverId: string,
): Promise<readonly StoredRequirementInstance[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, caregiverId },
      orderBy: { templateKey: 'asc' },
    })
    return rows.map(toStoredInstance)
  })
}

export function changeRequirementInstanceStatus(
  agencyId: string,
  instanceId: string,
  to: InstanceStatus,
): Promise<InstanceStatusChange> {
  return runInAuditedTransaction(async (tx) => {
    const instance = await tx.requirementInstance.findUnique({
      where: { agencyId_id: { agencyId, id: instanceId } },
      include: { _count: { select: { evidence: true } } },
    })
    if (instance === null) throw notFound(agencyId, instanceId)

    const result = transitionInstanceStatus(instance.status, to, {
      hasEvidence: instance._count.evidence > 0,
    })
    if (!result.ok) return result

    const { count } = await tx.requirementInstance.updateMany({
      where: { id: instanceId, agencyId, status: result.from },
      data: { status: result.to },
    })
    if (count === 0) {
      throw new Error(
        `Requirement instance ${instanceId} left ${result.from} while it was being moved to ` +
          `${result.to}; a concurrent writer changed it.`,
      )
    }

    return { ok: true, instance: toStoredInstance({ ...instance, status: result.to }) }
  })
}

/**
 * Links evidence without changing status; the caller transitions in the same transaction. A
 * frozen instance on an old template version may legitimately not accept a newer option.
 */
export function linkEvidence(
  agencyId: string,
  instanceId: string,
  evidenceKey: string,
  source: EvidenceSource,
): Promise<EvidenceLinkResult> {
  return runInAuditedTransaction(async (tx) => {
    const instance = await tx.requirementInstance.findUnique({
      where: { agencyId_id: { agencyId, id: instanceId } },
      include: { template: { include: { acceptedEvidence: true } } },
    })
    if (instance === null) throw notFound(agencyId, instanceId)

    if (!isAcceptedEvidence(instance.template.acceptedEvidence, { kind: source.kind, evidenceKey })) {
      return { ok: false, refusal: 'NOT_ACCEPTED' }
    }

    // The foreign key alone would accept another caregiver's document from the same agency.
    const owner = { agencyId, caregiverId: instance.caregiverId }
    let sourceColumn:
      | { signedDocumentId: string }
      | { uploadedDocumentId: string }
      | { attestationId: string }
      | { checkResultId: string }
      | { trainingCompletionId: string }
    switch (source.kind) {
      case 'SIGNED_DOCUMENT': {
        const document = await tx.signedDocument.findFirst({
          where: { id: source.signedDocumentId, ...owner },
          select: { id: true },
        })
        if (document === null) {
          throw new Error(
            `Signed document ${source.signedDocumentId} does not belong to the caregiver of ` +
              `requirement instance ${instanceId}.`,
          )
        }
        sourceColumn = { signedDocumentId: source.signedDocumentId }
        break
      }
      case 'UPLOADED_DOCUMENT': {
        const document = await tx.uploadedDocument.findFirst({
          where: { id: source.uploadedDocumentId, ...owner },
          select: { id: true },
        })
        if (document === null) {
          throw new Error(
            `Uploaded document ${source.uploadedDocumentId} does not belong to the caregiver of ` +
              `requirement instance ${instanceId}.`,
          )
        }
        sourceColumn = { uploadedDocumentId: source.uploadedDocumentId }
        break
      }
      case 'ATTESTATION': {
        const attestation = await tx.attestation.findFirst({
          where: { id: source.attestationId, ...owner },
          select: { id: true },
        })
        if (attestation === null) {
          throw new Error(
            `Attestation ${source.attestationId} does not belong to the caregiver of ` +
              `requirement instance ${instanceId}.`,
          )
        }
        sourceColumn = { attestationId: source.attestationId }
        break
      }
      case 'CHECK_RESULT': {
        const checkResult = await tx.checkResult.findFirst({
          where: { id: source.checkResultId, ...owner },
          select: { id: true },
        })
        if (checkResult === null) {
          throw new Error(
            `Check result ${source.checkResultId} does not belong to the caregiver of ` +
              `requirement instance ${instanceId}.`,
          )
        }
        sourceColumn = { checkResultId: source.checkResultId }
        break
      }
      case 'TRAINING_RECORD': {
        const completion = await tx.trainingCompletion.findFirst({
          where: { id: source.trainingCompletionId, ...owner },
          select: { id: true },
        })
        if (completion === null) {
          throw new Error(
            `Training completion ${source.trainingCompletionId} does not belong to the caregiver of ` +
              `requirement instance ${instanceId}.`,
          )
        }
        sourceColumn = { trainingCompletionId: source.trainingCompletionId }
        break
      }
    }

    const row = await tx.evidence.create({
      data: { agencyId, instanceId, kind: source.kind, evidenceKey, ...sourceColumn },
    })
    return {
      ok: true,
      evidence: {
        id: row.id,
        instanceId: row.instanceId,
        evidenceKey: row.evidenceKey,
        source,
        linkedAt: row.linkedAt,
      },
    }
  })
}
