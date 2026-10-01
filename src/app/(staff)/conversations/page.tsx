import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PIPELINE_STAGE_PRESENTATION } from '@/app/_lib/status'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import type { ConversationSummary } from '@/server/conversation/staff'
import { listConversationsForStaff } from '@/server/conversation/staff'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
})

const COLUMNS: ReadonlyArray<Column<ConversationSummary>> = [
  {
    key: 'caregiver',
    header: 'Caregiver',
    cell: (row) => (
      <Link
        href={`/caregivers/${row.caregiverId}`}
        prefetch={false}
        className="font-medium text-brand-700 underline"
      >
        {row.caregiverName}
      </Link>
    ),
  },
  {
    key: 'stage',
    header: 'Stage',
    cell: (row) => <StatusBadge {...PIPELINE_STAGE_PRESENTATION[row.stage]} size="sm" />,
  },
  {
    key: 'lastMessage',
    header: 'Last message',
    cell: (row) => <span className="line-clamp-2 break-words">{row.lastMessage}</span>,
  },
  { key: 'time', header: 'When', cell: (row) => TIME.format(row.lastMessageAt) },
  {
    key: 'flags',
    header: 'Agent',
    cell: (row) => (
      <span className="flex flex-wrap gap-2">
        {row.paused ? <StatusBadge tone="warning" label="Paused" glyph="clock" size="sm" /> : null}
        {row.handedOff ? <StatusBadge tone="danger" label="Handed off" glyph="alert" size="sm" /> : null}
        {row.needsReply ? <StatusBadge tone="danger" label="Needs reply" glyph="alert" size="sm" /> : null}
      </span>
    ),
  },
]

export default async function ConversationsPage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'conversation.manage')) notFound()

  const rows = await runAsPrincipal(principal, {}, () => listConversationsForStaff({}))

  return (
    <>
      <PageHeader title="Conversations" description="Text conversations with caregivers, newest first." />
      <DataTable
        caption="Conversations"
        columns={COLUMNS}
        rows={rows}
        getRowKey={(row) => row.caregiverId}
        empty="No conversations yet."
      />
    </>
  )
}
