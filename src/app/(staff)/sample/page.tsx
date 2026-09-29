import Link from 'next/link'
import { notFound } from 'next/navigation'
import { IDENTITY_OUTCOME_COPY, VERDICT_COPY } from '@/app/_lib/judge-review'
import type { SampledRecord } from '@/domain/documents/weekly-sample'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getWeeklySample } from '@/server/review/weekly-sample'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' })
// The week is defined in UTC; in New York time its Monday would be labelled a Sunday.
const WEEK = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function JudgeReasoningCell({ record }: { record: SampledRecord }) {
  const { judge, judgeReasoning } = record
  if (judge.basis.kind === 'ALLOWLISTED') {
    return <>{judge.basis.issuer.name} is on the accepted issuer list, so the judge was not asked.</>
  }
  const { verdict, confidence, modelVersion } = judge.basis
  return (
    <div className="flex flex-col gap-1">
      <span>
        {VERDICT_COPY[verdict]}, {Math.round(confidence * 100)}% confidence ({modelVersion})
      </span>
      {judgeReasoning.kind === 'CLINICAL' ? (
        <span className="text-sm text-ink-muted">
          The judge&apos;s reasons quote a clinic result and are kept in the medical record, so they are not shown here.
        </span>
      ) : (
        <ul className="text-sm text-ink-muted">
          {judgeReasoning.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const COLUMNS: ReadonlyArray<Column<SampledRecord>> = [
  {
    key: 'caregiver',
    header: 'Caregiver',
    cell: (record) => (
      // No prefetch: rendering the record writes a VIEW audit entry nobody made (ADR-094).
      <Link href={`/caregivers/${record.caregiverId}`} prefetch={false} className="font-medium text-brand-700 underline">
        {record.caregiverName ?? 'Name not yet provided'}
      </Link>
    ),
  },
  { key: 'requirement', header: 'Requirement', cell: (record) => record.requirementName },
  { key: 'accepted', header: 'Accepted', cell: (record) => DATE.format(record.acceptedAt) },
  {
    key: 'identity',
    header: 'Identity',
    cell: ({ identity }) =>
      `Name: ${IDENTITY_OUTCOME_COPY[identity.fullName]}. Date of birth: ${IDENTITY_OUTCOME_COPY[identity.dateOfBirth]}.`,
  },
  { key: 'judge', header: "Judge's reasoning", cell: (record) => <JudgeReasoningCell record={record} /> },
]

export default async function WeeklySamplePage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a supervisor is not told the page exists.
  if (!can(principal, 'weeklySample.view')) notFound()

  const sample = await runAsPrincipal(principal, {}, () => getWeeklySample({}))

  return (
    <>
      <PageHeader
        title="Weekly sample"
        description="Documents automatic review accepted last week, drawn at random for staff to check, with the judge's reasoning."
      />
      <section aria-labelledby="sample">
        <h2 id="sample" className="mb-2 text-base font-semibold text-ink">
          Week of {WEEK.format(sample.week.start)}: {sample.records.length} of {sample.autoAccepted} accepted
        </h2>
        <DataTable
          caption="Sampled documents"
          columns={COLUMNS}
          rows={sample.records}
          getRowKey={(record) => record.uploadedDocumentId}
          empty={<p className="text-sm text-ink-muted">Nothing was accepted automatically last week.</p>}
        />
      </section>
    </>
  )
}
