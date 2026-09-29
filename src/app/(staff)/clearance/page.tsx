import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PIPELINE_STAGE_PRESENTATION } from '@/app/_lib/status'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getClearanceList } from '@/server/clearance/clearance-list'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'

type Entry = Awaited<ReturnType<typeof getClearanceList>>[number]

const COLUMNS: ReadonlyArray<Column<Entry>> = [
  {
    key: 'caregiver',
    header: 'Caregiver',
    cell: (entry) => (
      // No prefetch: rendering the screen writes a VIEW audit entry nobody made (ADR-094).
      <Link
        href={`/clearance/${entry.caregiverId}`}
        prefetch={false}
        className="font-medium text-brand-700 underline"
      >
        {entry.name ?? 'Name not yet provided'}
      </Link>
    ),
  },
  {
    key: 'stage',
    header: 'Stage',
    cell: (entry) => <StatusBadge {...PIPELINE_STAGE_PRESENTATION[entry.stage]} size="sm" />,
  },
  {
    key: 'blocking',
    header: 'Blocking requirements',
    cell: ({ readiness }) => {
      if (readiness.ready) return 'All met'
      if (readiness.reason === 'NO_REQUIREMENTS') return 'None assigned yet'
      return `${readiness.outstanding.length} outstanding`
    },
  },
]

export default async function ClearancePage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a role without access is not told the page exists.
  if (!can(principal, 'clearance.view')) notFound()

  const entries = await runAsPrincipal(principal, {}, () => getClearanceList({}))

  return (
    <>
      <PageHeader
        title="Clearance"
        description="Caregivers still onboarding, and whether every blocking requirement is met."
      />
      <DataTable
        caption="Caregivers"
        columns={COLUMNS}
        rows={entries}
        getRowKey={(entry) => entry.caregiverId}
        empty={<p className="text-sm text-ink-muted">No caregivers are onboarding.</p>}
      />
    </>
  )
}
