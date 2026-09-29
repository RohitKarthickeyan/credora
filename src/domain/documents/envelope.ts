import type { DocumentField, DocumentRefusal } from '@/domain/documents/agency-document'
import { hasAgencyTemplate } from '@/domain/documents/agency-templates'
import type { DocumentSet, DocumentSetEntry } from '@/domain/documents/document-set'
import type { OfficialFormRefusal } from '@/domain/documents/official-form'
import { hasOfficialForm } from '@/domain/documents/official-forms'
import type { PipelineStage } from '@/domain/pipeline/stage'

// The source of truth for the envelope statuses. The Prisma enum `EnvelopeStatus` mirrors this
// list; keep the two in step.
export const ENVELOPE_STATUSES = ['PREPARING', 'SENT', 'SIGNED', 'DECLINED', 'VOIDED'] as const
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number]

export const SEND_STAGES: readonly PipelineStage[] = ['INTAKE', 'SIGNING']

export type PartitionedDocumentSet = {
  readonly official: readonly DocumentSetEntry[]
  readonly agency: readonly DocumentSetEntry[]
  readonly ungenerated: readonly string[]
}

export function partitionDocumentSet(set: DocumentSet): PartitionedDocumentSet {
  const official: DocumentSetEntry[] = []
  const agency: DocumentSetEntry[] = []
  const ungenerated: string[] = []
  for (const entry of set) {
    if (hasOfficialForm(entry.documentKey)) official.push(entry)
    else if (hasAgencyTemplate(entry.documentKey)) agency.push(entry)
    else ungenerated.push(entry.documentKey)
  }
  return { official, agency, ungenerated }
}

export type GenerationRefusal = DocumentRefusal | OfficialFormRefusal

export type SendProblem =
  | { readonly kind: 'vaccination-questions' }
  | { readonly kind: 'missing-answers'; readonly fields: readonly string[] }
  | {
      readonly kind: 'needs-staff'
      readonly documentKey: string
      readonly reason: 'no-template' | 'not-sign-only' | 'unprintable' | 'does-not-fit'
      readonly fields: readonly string[]
    }

// The caregiver answers these in their own intake step (T-084), so they get their own message.
const VACCINATION_FIELDS: ReadonlySet<string> = new Set<DocumentField>([
  'hepatitisBChoice',
  'fluVaccinationChoice',
  'fluDeclinationReason',
])

export function sendProblemsFrom(refusals: readonly GenerationRefusal[]): readonly SendProblem[] {
  let vaccination = false
  const missing = new Set<string>()
  const needsStaff: Extract<SendProblem, { kind: 'needs-staff' }>[] = []

  for (const refusal of refusals) {
    if (refusal.reason === 'missing-fields') {
      for (const field of refusal.fields) {
        if (VACCINATION_FIELDS.has(field)) vaccination = true
        else missing.add(field)
      }
      continue
    }
    needsStaff.push({
      kind: 'needs-staff',
      documentKey: refusal.documentKey,
      reason: refusal.reason,
      fields: 'fields' in refusal ? refusal.fields : [],
    })
  }

  const problems: SendProblem[] = []
  if (vaccination) problems.push({ kind: 'vaccination-questions' })
  if (missing.size > 0) problems.push({ kind: 'missing-answers', fields: [...missing].toSorted() })
  return [
    ...problems,
    ...needsStaff.toSorted((a, b) => (a.documentKey < b.documentKey ? -1 : 1)),
  ]
}

type SigningState = 'not-ready' | 'ready' | 'preparing' | 'sent' | 'signed'

export function signingStateFor(
  stage: PipelineStage,
  latest: { readonly status: EnvelopeStatus } | null,
): SigningState {
  switch (latest?.status) {
    case 'SIGNED':
      return 'signed'
    case 'SENT':
      return 'sent'
    case 'PREPARING':
      return 'preparing'
  }
  return SEND_STAGES.includes(stage) ? 'ready' : 'not-ready'
}

const NEW_YORK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Documents are dated in the agency's day, not UTC's (OPEN-QUESTIONS 122: every V1 agency is in New York).
export function issuedOnFor(now: Date): string {
  return NEW_YORK_DATE.format(now)
}
