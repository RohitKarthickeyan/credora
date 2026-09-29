import { notFound } from 'next/navigation'
import {
  ALAYACARE_PROFILE_FIELDS,
  type AlayaCareProfileField,
  RESOLVABLE_PROFILE_FIELDS,
} from '@/domain/sync/alayacare-conflict'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { type AlayaCareSide, getAlayaCareSyncIssue } from '@/server/sync/alayacare-sync-issues'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { LinkEmployee } from './link-employee'
import { RetrySync } from './retry-sync'

const FIELD_LABELS: Record<AlayaCareProfileField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
  email: 'Email',
  phone: 'Phone',
  startDate: 'Start date',
}

type ComparedField = {
  readonly field: AlayaCareProfileField
  readonly ours: string | null
  readonly theirs: string | null
  readonly conflicting: boolean
}

function theirsOf(side: AlayaCareSide, field: AlayaCareProfileField): string | null {
  if (side.kind === 'UNAVAILABLE') return 'AlayaCare is not responding — refresh to try again'
  if (side.kind === 'NO_MATCH') return 'No AlayaCare employee has this last name and date of birth'
  if (side.profile === null) return 'AlayaCare no longer has this employee'
  return side.profile[field]
}

const COLUMNS: ReadonlyArray<Column<ComparedField>> = [
  {
    key: 'field',
    header: 'Field',
    cell: (row) => (
      <span className={row.conflicting ? 'font-semibold text-status-danger-fg' : undefined}>
        {FIELD_LABELS[row.field]}
        {row.conflicting ? ' (conflict)' : null}
      </span>
    ),
  },
  { key: 'ours', header: 'Credora', cell: (row) => row.ours ?? '—' },
  { key: 'theirs', header: 'AlayaCare', cell: (row) => row.theirs ?? '—' },
]

export default async function AlayaCareConflictPage(props: PageProps<'/sync/[caregiverId]'>) {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'alayaCareSync.view')) notFound()

  const { caregiverId } = await props.params
  const issue = await runAsPrincipal(principal, {}, () => getAlayaCareSyncIssue({ caregiverId }))
  if (issue === null) notFound()

  const { alayaCare } = issue
  const rows = ALAYACARE_PROFILE_FIELDS.map((field) => ({
    field,
    ours: issue.ours[field],
    theirs: theirsOf(alayaCare, field),
    conflicting: issue.conflictFields.includes(field),
  }))
  const choosable =
    alayaCare.kind === 'LINKED'
      ? RESOLVABLE_PROFILE_FIELDS.filter((field) => issue.conflictFields.includes(field)).map((field) => ({
          field,
          label: FIELD_LABELS[field],
        }))
      : []

  return (
    <>
      <PageHeader
        title={issue.name ?? 'Name not yet provided'}
        description={issue.status === 'CONFLICT' ? 'AlayaCare holds different values' : 'Refused by AlayaCare'}
        back={{ href: '/sync', label: 'Back to AlayaCare conflicts' }}
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="reason" className="flex flex-col gap-3">
          <h2 id="reason" className="text-base font-semibold text-ink">
            Why the sync stopped
          </h2>
          <p>{issue.reason}</p>
        </section>

        <section aria-labelledby="compare" className="flex flex-col gap-3">
          <h2 id="compare" className="text-base font-semibold text-ink">
            Credora and AlayaCare
          </h2>
          <DataTable caption="Credora and AlayaCare values" columns={COLUMNS} rows={rows} getRowKey={(row) => row.field} />
        </section>

        <section aria-labelledby="resolve" className="flex flex-col items-start gap-4">
          <h2 id="resolve" className="text-base font-semibold text-ink">
            Resolve
          </h2>
          {issue.canRetry ? (
            <>
              {alayaCare.kind === 'CANDIDATE' ? (
                <LinkEmployee caregiverId={issue.caregiverId} externalId={alayaCare.profile.externalId} />
              ) : null}
              <RetrySync
                caregiverId={issue.caregiverId}
                fields={choosable}
                dateOfBirthConflict={issue.conflictFields.includes('dateOfBirth')}
                choices={issue.choices}
              />
            </>
          ) : (
            <p className="text-ink-muted">A retry is already queued.</p>
          )}
        </section>
      </div>
    </>
  )
}
