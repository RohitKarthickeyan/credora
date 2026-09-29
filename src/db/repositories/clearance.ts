import type { PipelineStage } from '@/domain/pipeline/stage'
import type { BlockerCandidate } from '@/domain/requirements/blocker'
import type { AuditedTx } from '../audit'
import { fromDateColumn } from '../mapping/date-only'

type ClearanceEvidenceRow =
  | { readonly kind: 'SIGNED_DOCUMENT'; readonly label: string; readonly signedDocumentId: string }
  | {
      readonly kind: 'UPLOADED_DOCUMENT' | 'CHECK_RESULT' | 'ATTESTATION' | 'TRAINING_RECORD'
      readonly label: string
      readonly at: Date
    }

type ClearanceRequirementRow = BlockerCandidate & {
  readonly instanceId: string
  readonly resultedOn: string | null
  readonly evidence: readonly ClearanceEvidenceRow[]
}

type ClearanceSheetRow = {
  readonly caregiverId: string
  readonly stage: PipelineStage
  readonly legalFirstName: string | null
  readonly legalLastName: string | null
  readonly requirements: readonly ClearanceRequirementRow[]
}

type EvidenceSourceRow = {
  readonly id: string
  readonly signedDocumentId: string | null
  readonly uploadedDocument: { readonly uploadedAt: Date } | null
  readonly checkResult: { readonly recordedAt: Date } | null
  readonly attestation: { readonly attestedAt: Date } | null
  readonly trainingCompletion: { readonly importedAt: Date } | null
}

// The arm comes from the source column that is set, not from `kind`: Evidence_exactly_one_source
// and the per-arm kind CHECKs make them agree.
function toEvidenceRow(evidence: EvidenceSourceRow, label: string): ClearanceEvidenceRow {
  if (evidence.signedDocumentId !== null) {
    return { kind: 'SIGNED_DOCUMENT', label, signedDocumentId: evidence.signedDocumentId }
  }
  if (evidence.uploadedDocument !== null) {
    return { kind: 'UPLOADED_DOCUMENT', label, at: evidence.uploadedDocument.uploadedAt }
  }
  if (evidence.checkResult !== null) {
    return { kind: 'CHECK_RESULT', label, at: evidence.checkResult.recordedAt }
  }
  if (evidence.attestation !== null) {
    return { kind: 'ATTESTATION', label, at: evidence.attestation.attestedAt }
  }
  // The import instant, not completedOn: the sheet formats `at` in America/New_York, which
  // would show a date-only value as the day before.
  if (evidence.trainingCompletion !== null) {
    return { kind: 'TRAINING_RECORD', label, at: evidence.trainingCompletion.importedAt }
  }
  throw new Error(`Evidence ${evidence.id} has no source.`)
}

// Identity is sensitive-tier: only the plaintext name columns are selected, never an `*Enc` one,
// and never a storage key. AuditedTx has no restricted delegate and Caregiver no relation to one,
// so medical and EEOC data cannot be reached from here.
export async function findClearanceSheet(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<ClearanceSheetRow | null> {
  const row = await tx.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: {
      id: true,
      stage: true,
      identity: { select: { legalFirstName: true, legalLastName: true } },
      requirementInstances: {
        orderBy: { templateKey: 'asc' },
        select: {
          id: true,
          templateKey: true,
          status: true,
          resultedOn: true,
          template: {
            select: {
              name: true,
              blocksClearance: true,
              acceptedEvidence: { select: { evidenceKey: true, label: true } },
            },
          },
          evidence: {
            orderBy: [{ linkedAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              evidenceKey: true,
              signedDocumentId: true,
              uploadedDocument: { select: { uploadedAt: true } },
              checkResult: { select: { recordedAt: true } },
              attestation: { select: { attestedAt: true } },
              trainingCompletion: { select: { importedAt: true } },
            },
          },
        },
      },
    },
  })
  if (row === null) return null

  return {
    caregiverId: row.id,
    stage: row.stage,
    legalFirstName: row.identity?.legalFirstName ?? null,
    legalLastName: row.identity?.legalLastName ?? null,
    requirements: row.requirementInstances.map((instance) => ({
      instanceId: instance.id,
      templateKey: instance.templateKey,
      status: instance.status,
      name: instance.template.name,
      blocksClearance: instance.template.blocksClearance,
      resultedOn: fromDateColumn(instance.resultedOn),
      evidence: instance.evidence.map((evidence) =>
        toEvidenceRow(
          evidence,
          instance.template.acceptedEvidence.find((a) => a.evidenceKey === evidence.evidenceKey)
            ?.label ?? evidence.evidenceKey,
        ),
      ),
    })),
  }
}
