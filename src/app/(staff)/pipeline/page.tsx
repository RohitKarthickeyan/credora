import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  PIPELINE_STAGE_PRESENTATION,
  REQUIREMENT_STATUS_PRESENTATION,
} from '@/app/_lib/status'
import type { PipelineBoardEntry } from '@/domain/pipeline/board'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getPipelineBoard } from '@/server/caregivers/pipeline-board'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'
import { WithdrawCaregiver } from './withdraw-caregiver'

const COLUMNS: ReadonlyArray<Column<PipelineBoardEntry>> = [
  {
    key: 'caregiver',
    header: 'Caregiver',
    cell: ({ caregiverId, name, conversation }) => (
      <span className="flex flex-wrap items-center gap-2">
        {/* No prefetch: rendering the record writes a VIEW audit entry nobody made (ADR-094). */}
        <Link href={`/caregivers/${caregiverId}`} prefetch={false} className="font-medium text-brand-700 underline">
          {name ?? 'Name not yet provided'}
        </Link>
        {conversation?.needsReply ? <StatusBadge tone="danger" label="Needs reply" glyph="alert" size="sm" /> : null}
        {conversation?.handedOff ? <StatusBadge tone="danger" label="Handed off" glyph="alert" size="sm" /> : null}
        {conversation?.paused ? <StatusBadge tone="warning" label="Paused" glyph="clock" size="sm" /> : null}
      </span>
    ),
  },
  {
    key: 'days',
    header: 'Days in stage',
    align: 'end',
    cell: (entry) => (entry.daysInStage === 1 ? '1 day' : `${entry.daysInStage} days`),
  },
  {
    key: 'blocker',
    header: 'Current blocker',
    cell: ({ blocker }) =>
      blocker === null ? (
        <span className="text-ink-muted">None outstanding</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          {blocker.blocker.name}
          <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[blocker.blocker.status]} size="sm" />
          {blocker.outstanding > 1 ? (
            <span className="text-sm text-ink-muted">+{blocker.outstanding - 1} more</span>
          ) : null}
        </span>
      ),
  },
]

const WITHDRAW_COLUMN: Column<PipelineBoardEntry> = {
  key: 'withdraw',
  header: 'Actions',
  align: 'end',
  cell: (entry) => <WithdrawCaregiver caregiverId={entry.caregiverId} name={entry.name} />,
}

export default async function PipelinePage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a role without access is not told the page exists.
  if (!can(principal, 'pipeline.view')) notFound()

  const columns = await runAsPrincipal(principal, {}, () => getPipelineBoard({}))
  const tableColumns = can(principal, 'caregiver.withdraw') ? [...COLUMNS, WITHDRAW_COLUMN] : COLUMNS

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Caregivers still onboarding, by stage, with days in stage and what is holding each one up."
        actions={
          can(principal, 'caregiver.invite') ? (
            <Link
              href="/caregivers/new"
              className="inline-flex min-h-touch items-center self-start rounded-control bg-brand-600 px-4 text-field font-medium text-ink-inverse hover:bg-brand-700"
            >
              Invite a caregiver
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-8">
        {columns.map(({ stage, entries }) => {
          const id = `stage-${stage.toLowerCase()}`
          const { label } = PIPELINE_STAGE_PRESENTATION[stage]
          return (
            <section key={stage} aria-labelledby={id}>
              <h2 id={id} className="mb-2 text-base font-semibold text-ink">
                {label} ({entries.length})
              </h2>
              <DataTable
                caption={`${label} caregivers`}
                columns={tableColumns}
                rows={entries}
                getRowKey={(entry) => entry.caregiverId}
                empty={<p className="text-sm text-ink-muted">No caregivers in this stage.</p>}
              />
            </section>
          )
        })}
      </div>
    </>
  )
}
