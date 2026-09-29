import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { CREDENTIAL_TYPE_LABELS } from '@/app/(staff)/admin/mapping/source-options'
import type { UnresolvedCustomField } from '@/domain/sync/alayacare-mapping'
import type { AlayaCarePreviewCredential, AlayaCarePreviewDocument } from '@/domain/sync/alayacare-preview'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getAlayaCarePreview } from '@/server/sync/alayacare-preview'
import { Alert } from '@/ui/alert'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'

// Date-only values: formatted in UTC so they never shift a day.
const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' })
const NOT_SENT = 'Not sent'

const formatDate = (value: string | null) => (value === null ? NOT_SENT : DATE.format(new Date(`${value}T00:00:00.000Z`)))

const MISSING_FIELD_WORDS = {
  legalFirstName: 'legal first name',
  legalLastName: 'legal last name',
  dateOfBirth: 'date of birth',
} as const

const UNRESOLVED_REASON: Record<UnresolvedCustomField['reason'], string> = {
  NO_VALUE: 'No value on the caregiver’s record',
  AMBIGUOUS_CREDENTIAL: 'More than one credential of that type, so none is chosen',
}

type Row = { readonly label: string; readonly value: string }

const PAIR_COLUMNS = (label: string, value: string): ReadonlyArray<Column<Row>> => [
  { key: 'label', header: label, cell: (row) => row.label },
  { key: 'value', header: value, cell: (row) => row.value },
]

const CREDENTIAL_COLUMNS: ReadonlyArray<Column<AlayaCarePreviewCredential>> = [
  { key: 'type', header: 'Type', cell: (credential) => CREDENTIAL_TYPE_LABELS[credential.type] },
  { key: 'code', header: 'AlayaCare code', cell: (credential) => credential.code },
  { key: 'number', header: 'Number', cell: (credential) => credential.number ?? NOT_SENT },
  { key: 'issuer', header: 'Issuer', cell: (credential) => credential.issuer ?? NOT_SENT },
  { key: 'issued', header: 'Issued', cell: (credential) => formatDate(credential.issuedOn) },
  { key: 'expires', header: 'Expires', cell: (credential) => formatDate(credential.expiresOn) },
  {
    key: 'file',
    header: 'Certificate file',
    cell: (credential) => (credential.documentAttached ? 'Attached' : NOT_SENT),
  },
]

const DOCUMENT_COLUMNS: ReadonlyArray<Column<AlayaCarePreviewDocument>> = [
  { key: 'document', header: 'Document', cell: (document) => document.templateKey },
  {
    key: 'sent',
    header: 'AlayaCare',
    cell: (document) => (document.sent ? `Sent as ${document.templateKey}.pdf` : NOT_SENT),
  },
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-base font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

export default async function AlayaCarePreviewPage(props: PageProps<'/caregivers/[id]/alayacare'>) {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a role without access is not told the page exists.
  if (!can(principal, 'caregiver.view')) notFound()

  const { id } = await props.params
  const preview = await runAsPrincipal(principal, {}, () => getAlayaCarePreview({ caregiverId: id }))
  if (preview === null) notFound()

  const { profile } = preview
  const sent = profile.ok ? profile.profile : null
  const profileRows: readonly Row[] = [
    { label: 'First name', value: sent?.firstName ?? NOT_SENT },
    { label: 'Last name', value: sent?.lastName ?? NOT_SENT },
    { label: 'Date of birth', value: formatDate(sent?.dateOfBirth ?? null) },
    { label: 'Email', value: sent?.email ?? NOT_SENT },
    { label: 'Phone', value: sent?.phone ?? NOT_SENT },
    { label: 'Start date', value: NOT_SENT },
  ]
  const customFieldRows: readonly Row[] = Object.entries(preview.customFields).map(([label, value]) => ({ label, value }))
  const unresolvedRows: readonly Row[] = preview.unresolvedCustomFields.map((field) => ({
    label: field.alayaCareKey,
    value: UNRESOLVED_REASON[field.reason],
  }))
  const hasGaps = preview.unmappedCredentialTypes.length > 0 || unresolvedRows.length > 0

  return (
    <>
      <PageHeader
        title="AlayaCare preview"
        description={preview.name ?? 'Name not yet provided'}
        back={{ href: `/clearance/${id}`, label: 'Back to clearance' }}
      />
      <div className="flex flex-col gap-8">
        <p className="text-sm text-ink">
          What an AlayaCare sync would send for this caregiver. Nothing has been sent.{' '}
          {preview.mappingVersion === 0 ? 'No mapping is saved yet.' : `Mapping version ${preview.mappingVersion}.`}
        </p>
        {profile.ok ? null : (
          <Alert tone="warning">
            The sync will stop before sending anything: the record has no{' '}
            {profile.missing.map((field) => MISSING_FIELD_WORDS[field]).join(', ')}.
          </Alert>
        )}
        <Section id="profile" title="Profile">
          <DataTable caption="Profile" columns={PAIR_COLUMNS('Field', 'Value')} rows={profileRows} getRowKey={(row) => row.label} />
        </Section>
        <Section id="credentials" title="Credentials">
          <DataTable
            caption="Credentials"
            columns={CREDENTIAL_COLUMNS}
            rows={preview.credentials}
            getRowKey={(credential) => credential.credentialId}
            empty={<p className="text-sm text-ink-muted">No credentials would be sent.</p>}
          />
        </Section>
        {preview.unmappedCredentialTypes.length > 0 ? (
          <Section id="unmapped" title="Not sent: no AlayaCare code">
            <ul className="list-disc ps-5 text-sm text-ink">
              {preview.unmappedCredentialTypes.map((type) => (
                <li key={type}>{CREDENTIAL_TYPE_LABELS[type]}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section id="custom-fields" title="Custom fields">
          <DataTable
            caption="Custom fields"
            columns={PAIR_COLUMNS('AlayaCare key', 'Value')}
            rows={customFieldRows}
            getRowKey={(row) => row.label}
            empty={<p className="text-sm text-ink-muted">No custom fields would be sent.</p>}
          />
        </Section>
        {unresolvedRows.length > 0 ? (
          <Section id="custom-fields-empty" title="Custom fields left empty">
            <DataTable
              caption="Custom fields left empty"
              columns={PAIR_COLUMNS('AlayaCare key', 'Reason')}
              rows={unresolvedRows}
              getRowKey={(row) => row.label}
            />
          </Section>
        ) : null}
        {hasGaps ? (
          can(principal, 'alayaCareMapping.manage') ? (
            <Link href="/admin/mapping" className="text-sm font-medium text-brand-700">
              Update the AlayaCare mapping
            </Link>
          ) : (
            <p className="text-sm text-ink-muted">An agency admin can update the AlayaCare mapping.</p>
          )
        ) : null}
        <Section id="documents" title="Signed documents">
          <DataTable
            caption="Signed documents"
            columns={DOCUMENT_COLUMNS}
            rows={preview.documents}
            getRowKey={(document) => document.id}
            empty={<p className="text-sm text-ink-muted">No signed documents yet.</p>}
          />
        </Section>
      </div>
    </>
  )
}
