import { notFound } from 'next/navigation'
import {
  EEOC_GENDER_CELLS,
  EEOC_RACE_ETHNICITY_CELLS,
  type EeocGenderCell,
  type EeocRaceEthnicityCell,
  type ReportedCell,
} from '@/domain/eeoc/aggregate-report'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getEeocAggregateReport } from '@/server/reports/eeoc-report'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'

const GENDER_LABELS: Record<EeocGenderCell, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  NON_BINARY: 'Non-binary',
  DECLINE_TO_SELF_IDENTIFY: 'Declined to self-identify',
  NOT_ANSWERED: 'Left blank',
}

const RACE_ETHNICITY_LABELS: Record<EeocRaceEthnicityCell, string> = {
  HISPANIC_OR_LATINO: 'Hispanic or Latino',
  WHITE: 'White',
  BLACK_OR_AFRICAN_AMERICAN: 'Black or African American',
  NATIVE_HAWAIIAN_OR_OTHER_PACIFIC_ISLANDER: 'Native Hawaiian or Other Pacific Islander',
  ASIAN: 'Asian',
  AMERICAN_INDIAN_OR_ALASKA_NATIVE: 'American Indian or Alaska Native',
  TWO_OR_MORE_RACES: 'Two or More Races',
  DECLINE_TO_SELF_IDENTIFY: 'Declined to self-identify',
  NOT_ANSWERED: 'Left blank',
}

type Row = { readonly key: string; readonly label: string; readonly cell: ReportedCell }

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { key: 'category', header: 'Category', cell: (row) => row.label },
  {
    key: 'caregivers',
    header: 'Caregivers',
    align: 'end',
    // Not "Fewer than 5": a cell hidden so another cannot be worked out may hold 5 or more.
    cell: (row) => (row.cell.suppressed ? 'Not shown' : row.cell.count),
  },
]

export default async function EeocReportPage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'eeocReport.view')) notFound()

  const report = await runAsPrincipal(principal, {}, () => getEeocAggregateReport({}))

  return (
    <>
      <PageHeader
        title="EEOC report"
        description="Current counts from the voluntary self-identification form, for caregivers who answered at least one question."
      />
      {report.status === 'WITHHELD' ? (
        <p className="text-ink">Fewer than 5 caregivers have answered the voluntary form, so nothing is shown.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-ink">{report.respondents} caregivers answered</p>
          <section aria-labelledby="gender">
            <h2 id="gender" className="mb-2 text-base font-semibold text-ink">
              Gender
            </h2>
            <DataTable
              caption="Caregivers by gender"
              columns={COLUMNS}
              rows={EEOC_GENDER_CELLS.map((key) => ({ key, label: GENDER_LABELS[key], cell: report.gender[key] }))}
              getRowKey={(row) => row.key}
            />
          </section>
          <section aria-labelledby="race-ethnicity">
            <h2 id="race-ethnicity" className="mb-2 text-base font-semibold text-ink">
              Race or ethnicity
            </h2>
            <DataTable
              caption="Caregivers by race or ethnicity"
              columns={COLUMNS}
              rows={EEOC_RACE_ETHNICITY_CELLS.map((key) => ({
                key,
                label: RACE_ETHNICITY_LABELS[key],
                cell: report.raceEthnicity[key],
              }))}
              getRowKey={(row) => row.key}
            />
          </section>
          <p className="text-sm text-ink-muted">
            Groups smaller than 5 are not shown, and nor is the next-smallest group where showing it would let a hidden
            number be worked out.
          </p>
        </div>
      )}
    </>
  )
}
