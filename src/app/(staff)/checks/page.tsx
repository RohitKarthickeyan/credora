import { notFound } from 'next/navigation'
import { REQUIREMENT_STATUS_PRESENTATION } from '@/app/_lib/status'
import type { BackgroundCheckTask } from '@/domain/requirements/background-check'
import type { ChrcTask } from '@/domain/requirements/chrc'
import type { ManualCheckTask } from '@/domain/requirements/manual-check'
import { type ReferenceCheckRow, isUnfavourable } from '@/domain/requirements/reference-check'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listManualChecks } from '@/server/review/manual-checks'
import { listBackgroundChecks } from '@/server/verification/background-check'
import { listChrcChecks } from '@/server/verification/chrc'
import { listReferenceChecks } from '@/server/verification/references'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'
import { AdjudicateBackgroundCheck } from './adjudicate-background-check'
import { DecideReferenceCheck } from './decide-reference-check'
import { OrderBackgroundCheck } from './order-background-check'
import { RecordChrcStep } from './record-chrc-step'
import { RecordManualCheck } from './record-manual-check'
import { RecordReferenceResponse } from './record-reference-response'
import { RequestReference } from './request-reference'

const COLUMNS: ReadonlyArray<Column<ManualCheckTask>> = [
  { key: 'caregiver', header: 'Caregiver', cell: (task) => task.caregiverName ?? 'Name not yet provided' },
  { key: 'requirement', header: 'Requirement', cell: (task) => task.requirementName },
  {
    key: 'reason',
    header: 'Why a person',
    cell: (task) => <span className="text-ink-muted">{task.reason}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (task) => <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[task.status]} size="sm" />,
  },
]

const RECORD_COLUMN: Column<ManualCheckTask> = {
  key: 'record',
  header: 'Actions',
  align: 'end',
  cell: (task) => (
    <RecordManualCheck
      instanceId={task.instanceId}
      caregiverName={task.caregiverName}
      requirementName={task.requirementName}
    />
  ),
}

const SUBMITTED_ON = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' })

const CHRC_COLUMNS: ReadonlyArray<Column<ChrcTask>> = [
  { key: 'caregiver', header: 'Caregiver', cell: (task) => task.caregiverName ?? 'Name not yet provided' },
  {
    key: 'submitted',
    header: 'Submitted to DOH',
    cell: (task) => (task.submittedAt === null ? 'Not submitted' : SUBMITTED_ON.format(task.submittedAt)),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (task) => <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[task.status]} size="sm" />,
  },
]

const CHRC_RECORD_COLUMN: Column<ChrcTask> = {
  key: 'record',
  header: 'Actions',
  align: 'end',
  // Keyed by step so the open submission dialog closes rather than turning into the result dialog.
  cell: (task) => (
    <RecordChrcStep
      key={task.nextStep}
      instanceId={task.instanceId}
      caregiverName={task.caregiverName}
      step={task.nextStep}
    />
  ),
}

function backgroundCheckProgress({ state, order }: BackgroundCheckTask): string {
  if (state === 'FAILED_AFTER_REVIEW') return 'Failed after staff review'
  if (state === 'NEEDS_REVIEW') return 'Vendor returned CONSIDER: review the report with the vendor'
  if (order !== null) {
    return `Ordered ${SUBMITTED_ON.format(order.requestedAt)}; vendor reports ${order.status.toLowerCase()}`
  }
  return state === 'READY_TO_ORDER' ? 'Disclosure signed' : 'Waiting for signed FCRA disclosure'
}

const BACKGROUND_CHECK_COLUMNS: ReadonlyArray<Column<BackgroundCheckTask>> = [
  { key: 'caregiver', header: 'Caregiver', cell: (task) => task.caregiverName ?? 'Name not yet provided' },
  {
    key: 'status',
    header: 'Status',
    cell: (task) => <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[task.status]} size="sm" />,
  },
  { key: 'progress', header: 'Progress', cell: backgroundCheckProgress },
]

function backgroundCheckActionColumn(canOrder: boolean, canAdjudicate: boolean): Column<BackgroundCheckTask> {
  return {
    key: 'order',
    header: 'Actions',
    align: 'end',
    cell: (task) => {
      if (task.state === 'READY_TO_ORDER' && canOrder) {
        return <OrderBackgroundCheck instanceId={task.instanceId} caregiverName={task.caregiverName} />
      }
      if (task.state === 'NEEDS_REVIEW' && canAdjudicate) {
        return (
          <div className="flex justify-end gap-2">
            <AdjudicateBackgroundCheck
              instanceId={task.instanceId}
              caregiverName={task.caregiverName}
              adjudication="CLEARED_AFTER_REVIEW"
            />
            <AdjudicateBackgroundCheck
              instanceId={task.instanceId}
              caregiverName={task.caregiverName}
              adjudication="FAILED_AFTER_REVIEW"
            />
          </div>
        )
      }
      return null
    },
  }
}

const yesNo = (answer: boolean) => (answer ? 'yes' : 'no')

function referenceProgress(row: ReferenceCheckRow) {
  if (row.requestStatus === 'NOT_REQUESTED') {
    return row.barred ? 'Caregiver asked us not to contact this employer' : 'Not requested'
  }
  if (row.requestStatus === 'ESCALATED') {
    return `2 requests unanswered: call ${row.phone ?? row.email ?? 'them'}`
  }
  if (row.requestStatus === 'REQUESTED') {
    const latest = row.attempts.at(-1)
    if (latest === undefined || latest.status === 'QUEUED') return 'Request queued'
    return latest.sentAt === null
      ? `Request ${latest.number} could not be delivered`
      : `Request ${latest.number} sent ${SUBMITTED_ON.format(latest.sentAt)}`
  }
  if (row.answer === null) return 'Answered'
  return (
    <div className="flex flex-col gap-1">
      <span>
        {`Answered${row.answer.byPhone ? ' by phone' : ''}: worked with them — ${yesNo(row.answer.workedWith)}; would recommend — ${yesNo(row.answer.wouldRecommend)}`}
      </span>
      {row.answer.comments === null ? null : <span className="text-ink-muted">{row.answer.comments}</span>}
    </div>
  )
}

const REFERENCE_COLUMNS: ReadonlyArray<Column<ReferenceCheckRow>> = [
  { key: 'caregiver', header: 'Caregiver', cell: (row) => row.caregiverName ?? 'Name not yet provided' },
  {
    key: 'reference',
    header: 'Reference',
    cell: (row) => (
      <div className="flex flex-col">
        <span>{row.referenceName}</span>
        <span className="text-ink-muted">
          {[row.relationship, row.employerName].filter((part) => part !== null && part !== '').join(' / ')}
        </span>
      </div>
    ),
  },
  { key: 'progress', header: 'Progress', cell: referenceProgress },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[row.checkStatus]} size="sm" />,
  },
]

function referenceActionColumn(canRequest: boolean, canRecord: boolean, canDecide: boolean): Column<ReferenceCheckRow> {
  return {
    key: 'actions',
    header: 'Actions',
    align: 'end',
    cell: (row) => {
      if (row.requestStatus === 'NOT_REQUESTED' && !row.barred && canRequest) {
        return (
          <RequestReference referenceId={row.referenceId} referenceName={row.referenceName} caregiverName={row.caregiverName} />
        )
      }
      if (row.requestStatus === 'ESCALATED' && canRecord) {
        return <RecordReferenceResponse referenceId={row.referenceId} referenceName={row.referenceName} />
      }
      if (canDecide && row.checkStatus === 'IN_REVIEW' && row.answer !== null && isUnfavourable(row.answer)) {
        return (
          <div className="flex justify-end gap-2">
            <DecideReferenceCheck
              caregiverId={row.caregiverId}
              caregiverName={row.caregiverName}
              decision="SATISFIED_AFTER_REVIEW"
            />
            <DecideReferenceCheck
              caregiverId={row.caregiverId}
              caregiverName={row.caregiverName}
              decision="FAILED_AFTER_REVIEW"
            />
          </div>
        )
      }
      return null
    },
  }
}

export default async function ChecksPage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a supervisor is not told the page exists.
  if (!can(principal, 'manualCheck.list')) notFound()

  const tasks = await runAsPrincipal(principal, {}, () => listManualChecks({}))
  const columns = can(principal, 'manualCheck.record') ? [...COLUMNS, RECORD_COLUMN] : COLUMNS
  const chrcTasks = can(principal, 'chrc.list')
    ? await runAsPrincipal(principal, {}, () => listChrcChecks({}))
    : null
  const chrcColumns = can(principal, 'chrc.record') ? [...CHRC_COLUMNS, CHRC_RECORD_COLUMN] : CHRC_COLUMNS
  const backgroundChecks = can(principal, 'backgroundCheck.list')
    ? await runAsPrincipal(principal, {}, () => listBackgroundChecks({}))
    : null
  const canOrder = can(principal, 'backgroundCheck.order')
  const canAdjudicate = can(principal, 'backgroundCheck.adjudicate')
  const backgroundCheckColumns =
    canOrder || canAdjudicate
      ? [...BACKGROUND_CHECK_COLUMNS, backgroundCheckActionColumn(canOrder, canAdjudicate)]
      : BACKGROUND_CHECK_COLUMNS
  const references = can(principal, 'reference.list')
    ? await runAsPrincipal(principal, {}, () => listReferenceChecks({}))
    : null
  const canRequest = can(principal, 'reference.request')
  const canDecide = can(principal, 'reference.decide')
  const referenceColumns =
    canRequest || canDecide
      ? [...REFERENCE_COLUMNS, referenceActionColumn(canRequest, can(principal, 'reference.recordResponse'), canDecide)]
      : REFERENCE_COLUMNS

  return (
    <>
      <PageHeader
        title="Staff checks"
        description="Checks the law assigns to a person. Do the check, then record it here; the record carries your name and the time."
      />
      <DataTable
        caption="Outstanding staff checks"
        columns={columns}
        rows={tasks}
        getRowKey={(task) => task.instanceId}
        empty={<p className="text-sm text-ink-muted">No staff checks outstanding.</p>}
      />
      {chrcTasks === null ? null : (
        <section className="mt-8 flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            Criminal history record checks are submitted to the NY DOH outside Credora. Record each step here when it
            happens.
          </p>
          <DataTable
            caption="Criminal history record checks"
            columns={chrcColumns}
            rows={chrcTasks}
            getRowKey={(task) => task.instanceId}
            empty={<p className="text-sm text-ink-muted">No criminal history record checks outstanding.</p>}
          />
        </section>
      )}
      {backgroundChecks === null ? null : (
        <section className="mt-8 flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            Background checks are ordered from the agency&apos;s vendor after the caregiver signs the standalone FCRA
            disclosure.
          </p>
          <DataTable
            caption="Background checks"
            columns={backgroundCheckColumns}
            rows={backgroundChecks}
            getRowKey={(task) => task.instanceId}
            empty={<p className="text-sm text-ink-muted">No background checks outstanding.</p>}
          />
        </section>
      )}
      {references === null ? null : (
        <section className="mt-8 flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            Each reference is sent a short web form. After two unanswered requests it comes back here for a phone call.
          </p>
          <DataTable
            caption="References"
            columns={referenceColumns}
            rows={references}
            getRowKey={(row) => row.referenceId}
            empty={<p className="text-sm text-ink-muted">No reference checks outstanding.</p>}
          />
        </section>
      )}
    </>
  )
}
