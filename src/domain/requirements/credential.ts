import type { NormalisedFields } from '@/domain/documents/extraction'
import type { CredentialType } from '@/domain/sync/alayacare-mapping'
import type { InstanceStatus } from './instance-status'
import type { RequirementTemplate } from './template'
import { expiryFor } from './validity'

type CredentialSourceDocument = {
  readonly uploadedDocumentId: string
  readonly evidenceKey: string
  // Its AutoAcceptDecision moved the instance to SATISFIED, or staff accepted it (ADR-110).
  readonly satisfiedInstance: boolean
  readonly fields: NormalisedFields
}

export type CredentialSource = {
  readonly instanceId: string
  readonly status: InstanceStatus
  readonly validity: Pick<RequirementTemplate, 'validityRule' | 'validityMonths'>
  // UPLOADED_DOCUMENT evidence, oldest upload first.
  readonly documents: readonly CredentialSourceDocument[]
}

export type ProjectedCredential = {
  readonly instanceId: string
  readonly uploadedDocumentId: string
  readonly type: CredentialType
  readonly number: string | null
  readonly issuer: string | null
  readonly issuedOn: string | null
  // null: never expires, or the expiry is unknown (OPEN-QUESTIONS candidate, ADR-107).
  readonly expiresOn: string | null
}

// Keyed by evidence key, not template key: AIDE_CERTIFICATION is one key whose HHA and PCA
// variants differ only in their evidence option (ADR-107).
const CREDENTIAL_TYPE_BY_EVIDENCE_KEY: Readonly<Record<string, CredentialType>> = {
  HHA_CERTIFICATE: 'HHA',
  PCA_CERTIFICATE: 'PCA',
  PHYSICAL_EXAM_REPORT: 'PHYSICAL',
  TB_PPD_RESULT: 'TB_CLEARANCE',
  TB_CHEST_XRAY: 'TB_CLEARANCE',
}

function projectCredential(source: CredentialSource): ProjectedCredential | null {
  if (source.status !== 'SATISFIED') return null
  // The document that satisfied the instance, else the latest upload.
  const document = source.documents.find((candidate) => candidate.satisfiedInstance) ?? source.documents.at(-1)
  if (document === undefined) return null
  const type = CREDENTIAL_TYPE_BY_EVIDENCE_KEY[document.evidenceKey]
  if (type === undefined) return null

  const { fields } = document
  // The judge's issue-date rule (judge-review.ts), so the recorded date is the one it checked.
  const issuedOn = fields.issueDate?.value ?? fields.completionDate?.value ?? null
  const expiry = expiryFor(source.validity, { issuedOn, evidenceExpiresOn: fields.expiryDate?.value ?? null })

  return {
    instanceId: source.instanceId,
    uploadedDocumentId: document.uploadedDocumentId,
    type,
    number: fields.documentNumber?.value ?? null,
    issuer: fields.issuer?.value ?? null,
    issuedOn,
    expiresOn: expiry.kind === 'ON' ? expiry.date : null,
  }
}

export function projectCredentials(sources: readonly CredentialSource[]): readonly ProjectedCredential[] {
  return sources.flatMap((source) => {
    const credential = projectCredential(source)
    return credential === null ? [] : [credential]
  })
}
