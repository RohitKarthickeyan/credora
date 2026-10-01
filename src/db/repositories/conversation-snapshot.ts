import { z } from 'zod'
import type { IntakeReadBack, ReplyContext } from '@/domain/conversation/replies'
import {
  type ConversationSnapshot,
  DEMO_DOCUMENTS,
  type DemoDocument,
  type DocumentState,
  TEXT_INTAKE_FIELDS,
  type TextIntakeField,
  documentState,
} from '@/domain/conversation/step'
import { RETURN_REASONS } from '@/domain/documents/review-outcome'
import type { Address } from '@/domain/validation/address'
import { runInAuditedTransaction, writeAuditEntry } from '../audit'
import { fromAddressColumns } from '../mapping/address'
import { fromDateColumn } from '../mapping/date-only'

type DocumentInstance = { readonly instanceId: string; readonly evidenceKey: string }

export type ConversationSnapshotView = {
  readonly snapshot: ConversationSnapshot
  readonly context: ReplyContext
  readonly documentInstances: Readonly<Record<DemoDocument, DocumentInstance>>
}

const NO_IDENTITY = { legalFirstName: null, legalLastName: null, dateOfBirth: null, sex: null, ssnLast4: null }
const NO_CONTACT = { email: null, line1: null, line2: null, city: null, state: null, zip: null }

function oneLine({ line1, line2, city, state, zip }: Address): string {
  return [line1, line2, city, `${state} ${zip}`].filter((part) => part !== undefined).join(', ')
}

function toMmDdYyyy(date: Date): string {
  const [year, month, day] = fromDateColumn(date).split('-')
  return `${month}/${day}/${year}`
}

/**
 * Everything a turn or a nudge reads about the caregiver, in one transaction: the step inputs,
 * the reply context and the instance each demo document is uploaded to. Null when the caregiver
 * has no conversation or is not on the demo requirement set.
 */
export function findConversationSnapshot(
  agencyId: string,
  caregiverId: string,
): Promise<ConversationSnapshotView | null> {
  return runInAuditedTransaction(async (tx) => {
    const caregiver = await tx.caregiver.findFirst({
      where: { agencyId, id: caregiverId },
      select: {
        stage: true,
        agency: { select: { name: true } },
        conversation: { select: { pausedAt: true, optedOutAt: true, unclearCount: true } },
        identity: {
          select: { legalFirstName: true, legalLastName: true, dateOfBirth: true, sex: true, ssnLast4: true },
        },
        contact: { select: { email: true, line1: true, line2: true, city: true, state: true, zip: true } },
        envelopes: { orderBy: { createdAt: 'desc' }, take: 1, select: { signingUrl: true } },
        requirementInstances: {
          where: { templateKey: { in: [...DEMO_DOCUMENTS] } },
          select: {
            id: true,
            templateKey: true,
            status: true,
            template: {
              select: {
                acceptedEvidence: { where: { kind: 'UPLOADED_DOCUMENT' }, take: 1, select: { evidenceKey: true } },
              },
            },
            evidence: {
              where: { uploadedDocumentId: { not: null } },
              orderBy: { linkedAt: 'desc' },
              take: 1,
              select: {
                uploadedDocument: {
                  select: {
                    staffDecision: { select: { decision: true } },
                    autoAcceptDecision: { select: { returnReason: true } },
                  },
                },
              },
            },
          },
        },
      },
    })
    if (caregiver === null || caregiver.conversation === null) return null

    const documents: Partial<Record<DemoDocument, DocumentState>> = {}
    const documentInstances: Partial<Record<DemoDocument, DocumentInstance>> = {}
    for (const document of DEMO_DOCUMENTS) {
      const instance = caregiver.requirementInstances.find((candidate) => candidate.templateKey === document)
      const evidenceKey = instance?.template.acceptedEvidence[0]?.evidenceKey
      if (instance === undefined || evidenceKey === undefined) return null
      const upload = instance.evidence[0]?.uploadedDocument
      documents[document] = documentState({
        status: instance.status,
        returnReason: z.enum(RETURN_REASONS).nullable().parse(upload?.autoAcceptDecision?.returnReason ?? null),
        staffDecision: upload?.staffDecision?.decision ?? null,
      })
      documentInstances[document] = { instanceId: instance.id, evidenceKey }
    }

    const { conversation } = caregiver
    const identity = caregiver.identity ?? NO_IDENTITY
    const contact = caregiver.contact ?? NO_CONTACT
    const present: Record<TextIntakeField, boolean> = {
      dateOfBirth: identity.dateOfBirth !== null,
      sex: identity.sex !== null,
      email: contact.email !== null,
      address: contact.line1 !== null,
      ssn: identity.ssnLast4 !== null,
    }
    const missingFields = TEXT_INTAKE_FIELDS.filter((field) => !present[field])

    const { legalFirstName, legalLastName, dateOfBirth, sex, ssnLast4 } = identity
    const { email } = contact
    const address = fromAddressColumns(contact)
    const readBack: IntakeReadBack | null =
      legalFirstName === null ||
      legalLastName === null ||
      dateOfBirth === null ||
      sex === null ||
      ssnLast4 === null ||
      email === null ||
      address.status !== 'complete'
        ? null
        : {
            legalName: `${legalFirstName} ${legalLastName}`,
            dateOfBirth: toMmDdYyyy(dateOfBirth),
            sex,
            email,
            address: oneLine(address.address),
            ssnLast4,
          }

    await writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: caregiverId })
    return {
      snapshot: {
        stage: caregiver.stage,
        paused: conversation.pausedAt !== null,
        optedOut: conversation.optedOutAt !== null,
        unclearCount: conversation.unclearCount,
        missingFields,
        documents: documents as Record<DemoDocument, DocumentState>,
      },
      context: {
        firstName: legalFirstName ?? '',
        agencyName: caregiver.agency.name,
        signingUrl: caregiver.envelopes[0]?.signingUrl ?? null,
        readBack,
      },
      documentInstances: documentInstances as Record<DemoDocument, DocumentInstance>,
    }
  })
}
