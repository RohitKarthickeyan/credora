import type { DocumentSetEntry } from '@/domain/documents/document-set'
import {
  FLU_VACCINATION_CHOICE_LABELS,
  type FluVaccinationStatement,
  HEPATITIS_B_CHOICE_LABELS,
  type HepatitisBChoice,
} from '@/domain/forms/vaccination'
import type { Address } from '@/domain/validation/address'
import type { PersonName } from '@/domain/validation/name'
import { formatPhone } from '@/domain/validation/phone'

const DOCUMENT_FIELDS = [
  'agencyName',
  'caregiverLegalName',
  'caregiverAddress',
  'caregiverMobilePhone',
  'hourlyRate',
  'issuedOn',
  'hepatitisBChoice',
  'fluVaccinationChoice',
  'fluDeclinationReason',
] as const
export type DocumentField = (typeof DOCUMENT_FIELDS)[number]

export const HISTORY_SECTIONS = ['employment', 'education', 'references'] as const
export type HistorySection = (typeof HISTORY_SECTIONS)[number]

export type TemplateBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'field'; readonly label: string; readonly field: DocumentField }
  | { readonly kind: 'history'; readonly section: HistorySection }

export type DocumentTemplate = {
  readonly documentKey: string
  readonly version: string
  readonly title: string
  readonly signOnly: boolean
  readonly blocks: readonly TemplateBlock[]
}

export type AgencyDocumentContext = {
  readonly agencyName: string
  readonly legalName: PersonName | null
  readonly address: Address | null
  readonly mobilePhone: string | null
  readonly hourlyRateCents: number | null
  readonly hepatitisBChoice: HepatitisBChoice | null
  readonly fluVaccination: FluVaccinationStatement | null
  readonly employment: readonly {
    readonly employerName: string
    readonly positionTitle: string | null
    readonly startedOn: string | null
    readonly endedOn: string | null
    readonly isCurrent: boolean
  }[]
  readonly education: readonly {
    readonly schoolName: string
    readonly programOrDegree: string | null
    readonly completedOn: string | null
  }[]
  readonly references: readonly {
    readonly fullName: string
    readonly relationship: string | null
    readonly phone: string | null
  }[]
}

export type RenderedBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'field'; readonly label: string; readonly value: string }
  | { readonly kind: 'signature'; readonly signerName: string }

export type RenderedDocument = {
  readonly documentKey: string
  readonly templateVersion: string
  readonly title: string
  readonly blocks: readonly RenderedBlock[]
}

export type DocumentRefusal =
  | { readonly documentKey: string; readonly reason: 'no-template' }
  | { readonly documentKey: string; readonly reason: 'not-sign-only' }
  | {
      readonly documentKey: string
      readonly reason: 'missing-fields'
      readonly fields: readonly DocumentField[]
    }

type RenderDocumentsResult =
  | { readonly ok: true; readonly documents: readonly RenderedDocument[] }
  | { readonly ok: false; readonly refusals: readonly DocumentRefusal[] }

type FieldValues = Readonly<Record<DocumentField, string | null>>

const TOKEN_PATTERN = /\{(\w+)\}/g

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function isSignOnly(entry: DocumentSetEntry): boolean {
  return entry.satisfies.every((requirement) => requirement.requirementType === 'ATTESTATION')
}

// Split, not parsed: a Date would put a date-only value through a timezone (date-only.ts).
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')

  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`
}

function formatLegalName(name: PersonName): string {
  return [name.first, name.middle, name.last, name.suffix]
    .filter((part) => part !== undefined)
    .join(' ')
}

function formatAddress(address: Address): string {
  const street = address.line2 === undefined ? address.line1 : `${address.line1}, ${address.line2}`

  return `${street}, ${address.city}, ${address.state} ${address.zip}`
}

function formatCents(cents: number): string {
  return `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

function fluDeclinationReason(statement: FluVaccinationStatement | null): string | null {
  if (statement === null) return null
  return statement.choice === 'DECLINED' ? statement.reason : 'Not applicable'
}

function fieldValues(context: AgencyDocumentContext, issuedOn: string): FieldValues {
  const { hepatitisBChoice, fluVaccination } = context

  return {
    agencyName: context.agencyName,
    caregiverLegalName: context.legalName === null ? null : formatLegalName(context.legalName),
    caregiverAddress: context.address === null ? null : formatAddress(context.address),
    caregiverMobilePhone: context.mobilePhone === null ? null : formatPhone(context.mobilePhone),
    hourlyRate: context.hourlyRateCents === null ? null : formatCents(context.hourlyRateCents),
    issuedOn: formatDate(issuedOn),
    hepatitisBChoice:
      hepatitisBChoice === null ? null : HEPATITIS_B_CHOICE_LABELS[hepatitisBChoice],
    fluVaccinationChoice:
      fluVaccination === null ? null : FLU_VACCINATION_CHOICE_LABELS[fluVaccination.choice],
    fluDeclinationReason: fluDeclinationReason(fluVaccination),
  }
}

function asField(name: string): DocumentField | undefined {
  return DOCUMENT_FIELDS.find((field) => field === name)
}

function referencedFields(template: DocumentTemplate): Set<DocumentField> {
  // Every document closes with a signature block naming the signer.
  const referenced = new Set<DocumentField>(['caregiverLegalName'])

  for (const block of template.blocks) {
    if (block.kind === 'field') referenced.add(block.field)
    if (block.kind !== 'paragraph') continue
    for (const match of block.text.matchAll(TOKEN_PATTERN)) {
      const field = asField(match[1] ?? '')
      if (field !== undefined) referenced.add(field)
    }
  }

  return referenced
}

function fillTokens(text: string, values: FieldValues): string {
  return text.replace(TOKEN_PATTERN, (token, name: string) => {
    const field = asField(name)

    return field === undefined ? token : (values[field] ?? token)
  })
}

function historyLines(context: AgencyDocumentContext, section: HistorySection): string[] {
  const joinParts = (head: string, detail: string | null, rest: readonly (string | null)[]) => {
    const lead = detail === null ? head : `${head} — ${detail}`
    return [lead, ...rest].filter((part) => part !== null && part !== '').join(', ')
  }

  switch (section) {
    case 'employment':
      return context.employment.map((job) => {
        const start = job.startedOn === null ? null : formatDate(job.startedOn)
        const end = job.isCurrent ? 'Present' : job.endedOn === null ? null : formatDate(job.endedOn)
        const span = [start, end].filter((part) => part !== null).join(' – ')
        return joinParts(job.employerName, job.positionTitle, [span])
      })
    case 'education':
      return context.education.map((school) =>
        joinParts(school.schoolName, school.programOrDegree, [
          school.completedOn === null ? null : `completed ${formatDate(school.completedOn)}`,
        ]),
      )
    case 'references':
      return context.references.map((reference) =>
        joinParts(reference.fullName, reference.relationship, [reference.phone]),
      )
  }
}

function renderBlock(
  block: TemplateBlock,
  context: AgencyDocumentContext,
  values: FieldValues,
): RenderedBlock[] {
  switch (block.kind) {
    case 'heading':
      return [block]
    case 'paragraph':
      return [{ kind: 'paragraph', text: fillTokens(block.text, values) }]
    case 'field':
      return [{ kind: 'field', label: block.label, value: values[block.field] ?? '' }]
    case 'history': {
      const lines = historyLines(context, block.section)
      const texts = lines.length === 0 ? ['None provided.'] : lines
      return texts.map((text) => ({ kind: 'paragraph', text }))
    }
  }
}

type EntryOutcome =
  | { readonly ok: true; readonly document: RenderedDocument }
  | { readonly ok: false; readonly refusal: DocumentRefusal }

function renderEntry(
  catalogue: readonly DocumentTemplate[],
  entry: DocumentSetEntry,
  context: AgencyDocumentContext,
  values: FieldValues,
): EntryOutcome {
  const { documentKey } = entry
  const template = catalogue.find((candidate) => candidate.documentKey === documentKey)
  if (template === undefined) return { ok: false, refusal: { documentKey, reason: 'no-template' } }

  // PRD: attestations are "sign-only, with no data entry". The reverse direction is allowed.
  if (isSignOnly(entry) && !template.signOnly) {
    return { ok: false, refusal: { documentKey, reason: 'not-sign-only' } }
  }

  const referenced = referencedFields(template)
  const missing = DOCUMENT_FIELDS.filter((field) => referenced.has(field) && values[field] === null)
  const signerName = values.caregiverLegalName
  if (missing.length > 0 || signerName === null) {
    return { ok: false, refusal: { documentKey, reason: 'missing-fields', fields: missing } }
  }

  return {
    ok: true,
    document: {
      documentKey,
      templateVersion: template.version,
      title: template.title,
      blocks: [
        ...template.blocks.flatMap((block) => renderBlock(block, context, values)),
        { kind: 'signature', signerName },
      ],
    },
  }
}

export function renderDocuments(
  catalogue: readonly DocumentTemplate[],
  entries: readonly DocumentSetEntry[],
  context: AgencyDocumentContext,
  issuedOn: string,
): RenderDocumentsResult {
  const values = fieldValues(context, issuedOn)
  const documents: RenderedDocument[] = []
  const refusals: DocumentRefusal[] = []

  for (const entry of entries) {
    const outcome = renderEntry(catalogue, entry, context, values)
    if (outcome.ok) documents.push(outcome.document)
    else refusals.push(outcome.refusal)
  }

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, documents }
}
