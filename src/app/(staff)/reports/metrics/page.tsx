import { notFound } from 'next/navigation'
import type { Ratio, SuccessMetricsReport } from '@/domain/reports/success-metrics'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getSuccessMetricsReport } from '@/server/reports/success-metrics'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'

const NONE = 'None in this period'
const MINUTES_PER_DAY = 1440

type Row = { readonly key: string; readonly metric: string; readonly value: string; readonly target: string }

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { key: 'metric', header: 'Metric', cell: (row) => row.metric },
  { key: 'value', header: 'Last 90 days', cell: (row) => row.value },
  { key: 'target', header: 'V1 target', cell: (row) => row.target },
]

function percent({ count, of }: Ratio): string {
  return of === 0 ? NONE : `${Math.round((count / of) * 100)}% (${count} of ${of})`
}

function rows(report: SuccessMetricsReport): readonly Row[] {
  const { daysToCleared, paperwork, fieldsRetyped } = report
  return [
    {
      key: 'staff-time',
      metric: 'Staff time per caregiver onboarded',
      value: 'Not measured in Credora: staff time is not recorded.',
      target: 'Under 20 minutes',
    },
    {
      key: 'days-to-cleared',
      metric: 'Days from accepted offer to cleared-to-work',
      value:
        daysToCleared.medianMinutes === null
          ? NONE
          : `${(daysToCleared.medianMinutes / MINUTES_PER_DAY).toFixed(1)} days median (${daysToCleared.caregivers} caregivers)`,
      target: 'Cut by half',
    },
    {
      key: 'paperwork',
      metric: 'Applicants who start paperwork but never finish',
      value:
        paperwork.started === 0
          ? NONE
          : `${percent({ count: paperwork.stopped, of: paperwork.started })}; ${paperwork.finished} finished, ${paperwork.inProgress} in progress`,
      target: 'Cut by half',
    },
    {
      key: 'fields-retyped',
      metric: 'Fields re-typed by staff per caregiver',
      value:
        fieldsRetyped.caregivers === 0
          ? NONE
          : `${(fieldsRetyped.fields / fieldsRetyped.caregivers).toFixed(1)} (${fieldsRetyped.fields} fields, ${fieldsRetyped.caregivers} caregivers)`,
      target: 'Zero',
    },
    {
      key: 'auto-accepted',
      metric: 'Uploads auto-accepted without staff review',
      value: percent(report.autoAccepted),
      target: '70% or more',
    },
    {
      key: 'sampled-invalid',
      metric: 'Auto-accepted records later found invalid in weekly sampling',
      value: 'Not measured in Credora: weekly sample findings are not recorded.',
      target: 'Under 1%',
    },
    {
      key: 'syncs',
      metric: 'AlayaCare syncs completed without manual fixes',
      value: percent(report.syncsWithoutManualFix),
      target: '95% or more',
    },
  ]
}

export default async function SuccessMetricsPage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'successMetrics.view')) notFound()

  const report = await runAsPrincipal(principal, {}, () => getSuccessMetricsReport({}))

  return (
    <>
      <PageHeader
        title="Success metrics"
        description="The last 90 days, computed from what Credora records. Targets are the PRD's V1 placeholders until Alvita's baseline is measured."
      />
      <DataTable caption="Success metrics" columns={COLUMNS} rows={rows(report)} getRowKey={(row) => row.key} />
    </>
  )
}
