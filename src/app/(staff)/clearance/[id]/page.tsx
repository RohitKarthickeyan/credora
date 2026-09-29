import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  PIPELINE_STAGE_PRESENTATION,
  REQUIREMENT_STATUS_PRESENTATION,
} from '@/app/_lib/status'
import { awaitsHealthScreeningResult } from '@/domain/requirements/health-screening'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getClearanceSheet } from '@/server/clearance/clearance-sheet'
import { isFirstAlayaCareSyncPending } from '@/server/sync/alayacare-preview'
import { Alert } from '@/ui/alert'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'
import { RecordHealthScreeningResult } from '../record-health-screening-result'
import { SignOffClearance } from '../sign-off-clearance'

type Sheet = NonNullable<Awaited<ReturnType<typeof getClearanceSheet>>>
type Requirement = Sheet['requirements'][number]

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })
// A result date is date-only: formatted in UTC so it never shifts a day.
const RESULT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' })

const EVIDENCE_VERB: Record<
  'SIGNED_DOCUMENT' | 'UPLOADED_DOCUMENT' | 'CHECK_RESULT' | 'ATTESTATION' | 'TRAINING_RECORD',
  string
> = {
  SIGNED_DOCUMENT: 'Signed',
  UPLOADED_DOCUMENT: 'Uploaded',
  CHECK_RESULT: 'Recorded',
  ATTESTATION: 'Submitted',
  TRAINING_RECORD: 'Imported',
}

const COLUMNS: ReadonlyArray<Column<Requirement>> = [
  { key: 'requirement', header: 'Requirement', cell: (requirement) => requirement.name },
  {
    key: 'status',
    header: 'Status',
    cell: (requirement) => (
      <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[requirement.status]} size="sm" />
    ),
  },
  {
    key: 'blocks',
    header: 'Blocks clearance',
    cell: (requirement) => (requirement.blocksClearance ? 'Yes' : 'No'),
  },
  {
    key: 'evidence',
    header: 'Evidence',
    cell: ({ evidence }) =>
      evidence.length === 0 ? (
        <span className="text-ink-muted">None yet</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {evidence.map((item, index) => (
            <li key={index}>
              {item.label} — {EVIDENCE_VERB[item.kind]} {DATE.format(item.at)}
              {item.kind === 'SIGNED_DOCUMENT' ? ` · version ${item.templateVersion}` : null}
            </li>
          ))}
        </ul>
      ),
  },
]

function SignOffBody({ sheet }: { sheet: Sheet }) {
  if (sheet.stage === 'CLEARANCE' && sheet.readiness.ready) {
    return <SignOffClearance caregiverId={sheet.caregiverId} caregiverName={sheet.name} />
  }
  if (sheet.stage === 'SYNCING' || sheet.stage === 'ACTIVE') {
    return <p className="text-sm text-ink">Signed off. {PIPELINE_STAGE_PRESENTATION[sheet.stage].label}.</p>
  }
  return (
    <p className="text-sm text-ink-muted">
      Sign-off opens when the caregiver reaches Clearance with every blocking requirement satisfied.
    </p>
  )
}

function ReadinessAlert({ readiness }: { readiness: Sheet['readiness'] }) {
  if (readiness.ready) {
    return (
      <Alert tone="success" title="Every blocking requirement is satisfied">
        Nothing blocking is outstanding.
      </Alert>
    )
  }
  if (readiness.reason === 'NO_REQUIREMENTS') {
    return (
      <Alert tone="neutral" title="No requirements assigned yet">
        Requirements are assigned when the caregiver is invited.
      </Alert>
    )
  }
  const count = readiness.outstanding.length
  return (
    <Alert
      tone="warning"
      title={
        count === 1
          ? '1 blocking requirement is outstanding'
          : `${count} blocking requirements are outstanding`
      }
    >
      {readiness.outstanding.map((requirement) => requirement.name).join(', ')}
    </Alert>
  )
}

export default async function ClearanceSheetPage(props: PageProps<'/clearance/[id]'>) {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a role without access is not told the page exists.
  if (!can(principal, 'clearance.view')) notFound()

  const { id } = await props.params
  const sheet = await runAsPrincipal(principal, {}, () => getClearanceSheet({ caregiverId: id }))
  if (sheet === null) notFound()
  const firstSyncPending = await runAsPrincipal(principal, {}, () => isFirstAlayaCareSyncPending({}))

  const canRecord = can(principal, 'healthScreening.record')
  const result = (requirement: Requirement): ReactNode => {
    if (requirement.resultedOn !== null) {
      return `Passed — result dated ${RESULT_DATE.format(new Date(`${requirement.resultedOn}T00:00:00.000Z`))}`
    }
    if (!awaitsHealthScreeningResult(requirement)) return null
    return canRecord ? (
      <RecordHealthScreeningResult
        instanceId={requirement.instanceId}
        caregiverId={sheet.caregiverId}
        caregiverName={sheet.name}
        requirementName={requirement.name}
      />
    ) : (
      'Awaiting the supervisor’s result'
    )
  }
  const columns: ReadonlyArray<Column<Requirement>> = [...COLUMNS, { key: 'result', header: 'Result', cell: result }]

  return (
    <>
      <PageHeader
        title={sheet.name ?? 'Name not yet provided'}
        description={PIPELINE_STAGE_PRESENTATION[sheet.stage].label}
        back={{ href: '/clearance', label: 'Back to clearance' }}
      />
      <div className="flex flex-col gap-8">
        <ReadinessAlert readiness={sheet.readiness} />
        {firstSyncPending && (sheet.stage === 'CLEARANCE' || sheet.stage === 'SYNCING') ? (
          <Alert tone="neutral" title="This agency has not synced to AlayaCare yet">
            {can(principal, 'caregiver.view') ? (
              // The preview writes a VIEW, so it is not prefetched (ADR-094).
              <Link href={`/caregivers/${id}/alayacare`} prefetch={false} className="font-medium text-brand-700">
                Preview what the sync will send
              </Link>
            ) : (
              'A coordinator or agency admin can preview what the sync will send.'
            )}
          </Alert>
        ) : null}
        <section aria-labelledby="requirements">
          <h2 id="requirements" className="mb-2 text-base font-semibold text-ink">
            Requirements
          </h2>
          <DataTable
            caption="Requirements"
            columns={columns}
            rows={sheet.requirements}
            getRowKey={(requirement) => requirement.templateKey}
          />
        </section>
        {can(principal, 'clearance.signOff') ? (
          <section aria-labelledby="sign-off">
            <h2 id="sign-off" className="mb-2 text-base font-semibold text-ink">
              Sign-off
            </h2>
            <SignOffBody sheet={sheet} />
          </section>
        ) : null}
      </div>
    </>
  )
}
