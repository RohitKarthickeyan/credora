import Link from 'next/link'
import { notFound } from 'next/navigation'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import type { AlayaCareSyncIssueSummary } from '@/server/sync/alayacare-sync-issues'
import { listAlayaCareSyncIssues } from '@/server/sync/alayacare-sync-issues'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
  email: 'Email',
  phone: 'Phone',
  startDate: 'Start date',
}

const COLUMNS: ReadonlyArray<Column<AlayaCareSyncIssueSummary>> = [
  {
    key: 'caregiver',
    header: 'Caregiver',
    cell: (issue) => (
      <Link href={`/sync/${issue.caregiverId}`} className="font-medium text-ink underline">
        {issue.name ?? 'Name not yet provided'}
      </Link>
    ),
  },
  { key: 'status', header: 'Outcome', cell: (issue) => (issue.status === 'CONFLICT' ? 'Conflict' : 'Refused by AlayaCare') },
  {
    key: 'fields',
    header: 'Conflicting fields',
    cell: (issue) => issue.conflictFields.map((field) => FIELD_LABELS[field] ?? field).join(', '),
  },
  { key: 'stopped', header: 'Stopped', cell: (issue) => DATE.format(issue.finishedAt) },
  {
    key: 'retry',
    header: 'Retry',
    cell: (issue) => (issue.canRetry ? null : <span className="text-ink-muted">Retry queued</span>),
  },
]

export default async function AlayaCareConflictsPage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'alayaCareSync.view')) notFound()

  const issues = await runAsPrincipal(principal, {}, () => listAlayaCareSyncIssues({}))

  return (
    <>
      <PageHeader
        title="AlayaCare conflicts"
        description="Syncs that stopped because AlayaCare holds different values or refused the caregiver."
      />
      <DataTable
        caption="AlayaCare conflicts"
        columns={COLUMNS}
        rows={issues}
        getRowKey={(issue) => issue.caregiverId}
        empty="No AlayaCare sync is waiting on staff."
      />
    </>
  )
}
