import { notFound } from 'next/navigation'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import type { TrainingOverview } from '@/server/training/training-hours'
import { getTrainingOverview } from '@/server/training/training-hours'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'
import { LinkTrainingAccount } from './link-training-account'
import { ScheduleTrainingImport } from './schedule-training-import'

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function hours(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`
}

type HoursRow = TrainingOverview['hours'][number]
type UnmatchedRow = TrainingOverview['unmatched'][number]
type CourseRow = TrainingOverview['uncountedCourses'][number]
type ImportRow = TrainingOverview['imports'][number]

const HOURS_COLUMNS: ReadonlyArray<Column<HoursRow>> = [
  { key: 'caregiver', header: 'Caregiver', cell: (row) => row.caregiverName ?? 'Name not yet provided' },
  { key: 'requirement', header: 'Requirement', cell: (row) => row.requirementName },
  { key: 'completed', header: 'Completed this year', cell: (row) => hours(row.completedMinutes), align: 'end' },
  { key: 'minimum', header: 'Annual minimum', cell: (row) => hours(row.minimumMinutes), align: 'end' },
  {
    key: 'flag',
    header: 'Standing',
    cell: (row) =>
      row.shortfallMinutes > 0 ? (
        <StatusBadge tone="danger" glyph="alert" label={`Short by ${hours(row.shortfallMinutes)}`} />
      ) : (
        <StatusBadge tone="success" glyph="check" label="Met" />
      ),
  },
]

const COURSE_COLUMNS: ReadonlyArray<Column<CourseRow>> = [
  { key: 'code', header: 'Course code', cell: (row) => row.courseCode },
  { key: 'name', header: 'Course', cell: (row) => row.courseName },
  { key: 'completions', header: 'Completions', cell: (row) => row.completions, align: 'end' },
]

const IMPORT_COLUMNS: ReadonlyArray<Column<ImportRow>> = [
  { key: 'when', header: 'Imported', cell: (row) => DATE_TIME.format(row.importedAt) },
  { key: 'source', header: 'Source', cell: (row) => row.sourceRef },
  { key: 'read', header: 'Rows read', cell: (row) => row.recordCount, align: 'end' },
  { key: 'new', header: 'New', cell: (row) => row.addedCount, align: 'end' },
  {
    key: 'rejected',
    header: 'Rejected rows',
    cell: (row) =>
      row.rejected.length === 0 ? (
        'None'
      ) : (
        <ul className="flex flex-col gap-1">
          {row.rejected.map(({ line, reason }) => (
            <li key={line}>
              Line {line}: {reason}
            </li>
          ))}
        </ul>
      ),
  },
]

export default async function TrainingPage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'training.view')) notFound()

  const overview = await runAsPrincipal(principal, {}, () => getTrainingOverview({}))
  const caregivers = overview.linkableCaregivers.map((caregiver) => ({
    value: caregiver.caregiverId,
    label: caregiver.caregiverName ?? 'Name not yet provided',
  }))

  const unmatchedColumns: ReadonlyArray<Column<UnmatchedRow>> = [
    { key: 'id', header: 'Platform id', cell: (row) => row.externalCaregiverId },
    { key: 'completions', header: 'Completions', cell: (row) => row.completions, align: 'end' },
    { key: 'hours', header: 'Hours', cell: (row) => hours(row.minutes), align: 'end' },
    {
      key: 'link',
      header: 'Link to caregiver',
      cell: (row) => <LinkTrainingAccount externalCaregiverId={row.externalCaregiverId} caregivers={caregivers} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Training"
        description="Orientation and in-service hours imported from the agency's training platform."
      />
      <div className="flex flex-col gap-8 pb-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Hours against annual minimums</h2>
          <DataTable
            caption="In-service hours this calendar year against the annual minimum"
            columns={HOURS_COLUMNS}
            rows={overview.hours}
            getRowKey={(row) => `${row.caregiverId}:${row.requirementName}`}
            empty="No caregiver has an annual training minimum."
          />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Platform ids with no caregiver</h2>
          <DataTable
            caption="Training platform ids with no caregiver"
            columns={unmatchedColumns}
            rows={overview.unmatched}
            getRowKey={(row) => row.externalCaregiverId}
            empty="Every imported platform id belongs to a caregiver."
          />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Courses not counted</h2>
          <p className="text-sm text-ink-muted">
            Course codes that start with ORIENT- count as orientation and INSVC- as in-service.
          </p>
          <DataTable
            caption="Courses not counted toward any requirement"
            columns={COURSE_COLUMNS}
            rows={overview.uncountedCourses}
            getRowKey={(row) => `${row.courseCode}:${row.courseName}`}
            empty="Every imported course counts as orientation or in-service."
          />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Recent imports</h2>
          <DataTable
            caption="Recent training imports"
            columns={IMPORT_COLUMNS}
            rows={overview.imports}
            getRowKey={(row) => row.id}
            empty="Nothing has been imported yet."
          />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Daily import</h2>
          {overview.schedule !== null ? (
            <p className="text-sm text-ink">
              {overview.schedule.sourceRef} is imported daily. Next run {DATE_TIME.format(overview.schedule.nextOccurrenceAt)}.
            </p>
          ) : can(principal, 'trainingImport.schedule') ? (
            <ScheduleTrainingImport />
          ) : (
            <p className="text-sm text-ink-muted">No daily import is scheduled. An agency admin can turn it on.</p>
          )}
        </section>
      </div>
    </>
  )
}
