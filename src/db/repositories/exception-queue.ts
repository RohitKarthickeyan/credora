import type { QueueDocument, ReturnedToCaregiver } from '@/domain/documents/exception-queue'
import { type CaregiverNoticeStatus, RETURN_DECISIONS, type ReturnDecision } from '@/domain/documents/staff-decision'
import { prisma } from '../prisma'
import { isClinical } from './extractions'

export type FlaggedDocumentRow = QueueDocument & {
  readonly flaggedAt: Date
  readonly clinical: boolean
  readonly returned: Omit<ReturnedToCaregiver, 'stoppedNoticeJobId'> | null
}

// IdentityRecord is sensitive-tier: only the two plaintext name columns are selected, never an
// encrypted one.
export const DOCUMENT_SELECT = {
  id: true,
  storageKey: true,
  caregiverId: true,
  caregiver: { select: { identity: { select: { legalFirstName: true, legalLastName: true } } } },
  evidence: { select: { instance: { select: { id: true, templateKey: true, template: { select: { name: true } } } } } },
} as const

type LegalName = { readonly legalFirstName: string | null; readonly legalLastName: string | null } | null

function caregiverName(identity: LegalName): string | null {
  const nameParts = [identity?.legalFirstName ?? null, identity?.legalLastName ?? null].filter((part) => part !== null)
  return nameParts.length === 0 ? null : nameParts.join(' ')
}

type DocumentRow = {
  readonly id: string
  readonly caregiverId: string
  readonly caregiver: { readonly identity: LegalName }
  readonly evidence: readonly {
    readonly instance: { readonly id: string; readonly templateKey: string; readonly template: { readonly name: string } }
  }[]
}

export function toQueueDocument(row: DocumentRow): QueueDocument {
  const [link, ...others] = row.evidence
  if (link === undefined || others.length > 0) {
    throw new Error(
      `Uploaded document ${row.id} has ${row.evidence.length} evidence rows; exactly one is expected (T-070).`,
    )
  }
  return {
    uploadedDocumentId: row.id,
    instanceId: link.instance.id,
    templateKey: link.instance.templateKey,
    requirementName: link.instance.template.name,
    caregiverId: row.caregiverId,
    caregiverName: caregiverName(row.caregiver.identity),
  }
}

function isReturnDecision(decision: string): decision is ReturnDecision {
  return (RETURN_DECISIONS as readonly string[]).includes(decision)
}

type StaffDecisionRow = {
  readonly id: string
  readonly decision: string
  readonly decidedAt: Date
  readonly caregiverNotice: CaregiverNoticeStatus | null
}

// The query's filter and saveStaffDocumentDecision make both throws unreachable.
function toReturned(uploadedDocumentId: string, row: StaffDecisionRow | null): FlaggedDocumentRow['returned'] {
  if (row === null) return null
  const { id, decision, decidedAt, caregiverNotice } = row
  if (caregiverNotice === null || !isReturnDecision(decision)) {
    throw new Error(`Uploaded document ${uploadedDocumentId} is on the queue with a staff decision that returned nothing.`)
  }
  return { staffDecisionId: id, decision, decidedAt, notice: caregiverNotice }
}

/**
 * Documents whose auto-accept decision set their instance to EXCEPTION, the instance still there
 * (ADR-105), undecided or returned to the caregiver by staff (ADR-110).
 */
export async function findFlaggedDocumentRows(agencyId: string): Promise<readonly FlaggedDocumentRow[]> {
  const rows = await prisma.autoAcceptDecision.findMany({
    where: {
      agencyId,
      instanceStatusSet: 'EXCEPTION',
      uploadedDocument: {
        caregiver: { stage: { not: 'WITHDRAWN' } },
        evidence: { some: { instance: { status: 'EXCEPTION' } } },
        OR: [
          { staffDecision: { is: null } },
          { staffDecision: { is: { decision: { in: [...RETURN_DECISIONS] } } } },
        ],
      },
    },
    select: {
      decidedAt: true,
      uploadedDocument: {
        select: {
          ...DOCUMENT_SELECT,
          staffDecision: { select: { id: true, decision: true, decidedAt: true, caregiverNotice: true } },
        },
      },
    },
  })

  return rows.map(({ decidedAt, uploadedDocument }) => ({
    ...toQueueDocument(uploadedDocument),
    flaggedAt: decidedAt,
    clinical: isClinical(uploadedDocument.storageKey),
    returned: toReturned(uploadedDocument.id, uploadedDocument.staffDecision),
  }))
}

/** Of the given documents, those still undecided with their instance PENDING (ADR-106). */
export async function findStalledReviewDocuments(
  agencyId: string,
  uploadedDocumentIds: readonly string[],
): Promise<readonly QueueDocument[]> {
  if (uploadedDocumentIds.length === 0) return []
  const rows = await prisma.uploadedDocument.findMany({
    where: {
      agencyId,
      id: { in: [...uploadedDocumentIds] },
      autoAcceptDecision: { is: null },
      caregiver: { stage: { not: 'WITHDRAWN' } },
      evidence: { some: { instance: { status: 'PENDING' } } },
    },
    select: DOCUMENT_SELECT,
  })
  return rows.map(toQueueDocument)
}

type OpenEnvelopeRow = {
  readonly envelopeId: string
  readonly vendorEnvelopeId: string | null
  readonly caregiverId: string
  readonly caregiverName: string | null
}

/**
 * Of the given envelopes, those still waiting on the stopped step: PREPARING by id, SENT by vendor
 * id; caregiver not withdrawn. A signed, voided or declined envelope is not stuck.
 */
export async function findOpenEnvelopes(
  agencyId: string,
  ids: { readonly envelopeIds: readonly string[]; readonly vendorEnvelopeIds: readonly string[] },
): Promise<readonly OpenEnvelopeRow[]> {
  if (ids.envelopeIds.length === 0 && ids.vendorEnvelopeIds.length === 0) return []
  const rows = await prisma.envelope.findMany({
    where: {
      agencyId,
      caregiver: { stage: { not: 'WITHDRAWN' } },
      OR: [
        { id: { in: [...ids.envelopeIds] }, status: 'PREPARING' },
        { vendorEnvelopeId: { in: [...ids.vendorEnvelopeIds] }, status: 'SENT' },
      ],
    },
    select: {
      id: true,
      vendorEnvelopeId: true,
      caregiverId: true,
      caregiver: { select: { identity: { select: { legalFirstName: true, legalLastName: true } } } },
    },
  })
  return rows.map((row) => ({
    envelopeId: row.id,
    vendorEnvelopeId: row.vendorEnvelopeId,
    caregiverId: row.caregiverId,
    caregiverName: caregiverName(row.caregiver.identity),
  }))
}
