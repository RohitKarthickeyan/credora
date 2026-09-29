import Link from 'next/link'
import { notFound } from 'next/navigation'
import { IDENTITY_OUTCOME_COPY, VERDICT_COPY } from '@/app/_lib/judge-review'
import type { AutoAcceptStaffReason, UnconfidentReading } from '@/domain/documents/auto-accept'
import type {
  FlaggedDocument,
  ReturnedToCaregiver,
  ReviewStep,
  SigningStep,
  StalledReview,
  StalledSigning,
} from '@/domain/documents/exception-queue'
import type { JudgeStaffReason } from '@/domain/documents/judge-review'
import {
  type CaregiverNoticeStatus,
  QUEUE_DECISIONS,
  type ReturnDecision,
  STAFF_DECISIONS,
} from '@/domain/documents/staff-decision'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getExceptionQueue } from '@/server/review/exception-queue'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { SubmitButton } from '@/ui/submit-button'
import { retryStoppedJobAction } from './actions'
import { DecideException } from './decide-exception'

const AUTO_ACCEPT_REASON_COPY: Record<AutoAcceptStaffReason, string> = {
  MANUAL_ONLY: 'The law assigns this check to a person.',
  EXTRACTION_NOT_CONFIDENT: 'The document was not read clearly enough.',
  IDENTITY_NOT_MATCHED: 'Name or date of birth does not agree with intake.',
  JUDGE_NOT_RUN: 'The judge step did not run.',
  JUDGE_NOT_PASSED: 'The judge step did not pass.',
}

const JUDGE_STAFF_REASON_COPY: Record<JudgeStaffReason, string> = {
  MANUAL_ONLY: 'person-assigned requirement',
  EXPIRED: 'expired',
  EXPIRY_UNKNOWN: 'expiry date could not be worked out',
  ISSUED_IN_FUTURE: 'issue date is in the future',
  ISSUED_AFTER_EXPIRY: 'issued after its expiry date',
  VERDICT_INVALID: 'judge found it invalid',
  VERDICT_UNCERTAIN: 'judge was uncertain',
  LOW_JUDGE_CONFIDENCE: "judge's confidence was too low",
  MOCK_VERDICT_WITHOUT_ALLOWLIST: 'test judge only, and the issuer is not on the accepted list',
}

const UNCONFIDENT_READING_COPY: Record<UnconfidentReading, string> = {
  OVERALL: 'the document overall',
  fullName: 'name',
  dateOfBirth: 'date of birth',
  issueDate: 'issue date',
  completionDate: 'completion date',
  expiryDate: 'expiry date',
}

const REVIEW_STEP_COPY: Record<ReviewStep, string> = {
  EXTRACTION: 'Reading the document',
  JUDGE: 'Judge step',
  AUTO_ACCEPT: 'Decision step',
}

const SIGNING_STEP_COPY: Record<SigningStep, string> = {
  SEND: 'Sending the documents for signature',
  RECORD: 'Recording the signed documents',
}

const RETURN_COPY: Record<ReturnDecision, string> = {
  REJECTED: 'A different document',
  REUPLOAD_REQUESTED: 'A clearer photo',
}

const NOTICE_COPY: Record<CaregiverNoticeStatus, string> = {
  QUEUED: 'Sending',
  SENT: 'Sent',
  REJECTED: 'Not delivered',
  NO_EMAIL: 'Not sent: no email address',
  CANCELLED: 'Not needed',
}

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' })

function caregiverLink(item: { caregiverId: string; caregiverName: string | null }) {
  return (
    // No prefetch: rendering the record writes a VIEW audit entry nobody made (ADR-094).
    <Link href={`/caregivers/${item.caregiverId}`} prefetch={false} className="font-medium text-brand-700 underline">
      {item.caregiverName ?? 'Name not yet provided'}
    </Link>
  )
}

function failureDetail(item: FlaggedDocument, reason: AutoAcceptStaffReason): string | null {
  switch (reason) {
    case 'EXTRACTION_NOT_CONFIDENT':
      return `Not read clearly: ${item.unconfidentReadings.map((reading) => UNCONFIDENT_READING_COPY[reading]).join(', ')}`
    case 'IDENTITY_NOT_MATCHED': {
      const { fullName, dateOfBirth } = item.autoAccept.identity
      return `Name: ${IDENTITY_OUTCOME_COPY[fullName]}. Date of birth: ${IDENTITY_OUTCOME_COPY[dateOfBirth]}.`
    }
    case 'JUDGE_NOT_PASSED':
      return item.judge?.outcome.kind === 'STAFF'
        ? item.judge.outcome.reasons.map((judgeReason) => JUDGE_STAFF_REASON_COPY[judgeReason]).join('; ')
        : null
    case 'MANUAL_ONLY':
    case 'JUDGE_NOT_RUN':
      return null
  }
}

function WhatFailed({ item }: { item: FlaggedDocument }) {
  const { outcome } = item.autoAccept
  const reasons = outcome.kind === 'STAFF' ? outcome.reasons : []
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((reason) => {
        const detail = failureDetail(item, reason)
        return (
          <li key={reason}>
            {AUTO_ACCEPT_REASON_COPY[reason]}
            {detail === null ? null : <span className="block text-sm text-ink-muted">{detail}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function JudgeReasoningCell({ item }: { item: FlaggedDocument }) {
  const { judge, judgeReasoning } = item
  if (judge === null) return <>The judge did not run: nothing could be read from the document.</>
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

const FLAGGED_COLUMNS: ReadonlyArray<Column<FlaggedDocument>> = [
  { key: 'caregiver', header: 'Caregiver', cell: caregiverLink },
  { key: 'requirement', header: 'Requirement', cell: (item) => item.requirementName },
  { key: 'flagged', header: 'Flagged', cell: (item) => DATE.format(item.flaggedAt) },
  { key: 'failed', header: 'What failed', cell: (item) => <WhatFailed item={item} /> },
  { key: 'judge', header: "Judge's reasoning", cell: (item) => <JudgeReasoningCell item={item} /> },
]

type Returned = FlaggedDocument & { readonly returned: ReturnedToCaregiver }

function RetryForm({ jobId }: { jobId: string }) {
  return (
    <form action={retryStoppedJobAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Retrying…">
        Retry
      </SubmitButton>
    </form>
  )
}

function NoticeCell({ returned, canRetry }: { returned: ReturnedToCaregiver; canRetry: boolean }) {
  if (returned.stoppedNoticeJobId === null) return <>{NOTICE_COPY[returned.notice]}</>
  return (
    <span className="flex flex-wrap items-center gap-2">
      Sending stopped
      {canRetry ? <RetryForm jobId={returned.stoppedNoticeJobId} /> : null}
    </span>
  )
}

const STALLED_COLUMNS: ReadonlyArray<Column<StalledReview>> = [
  { key: 'caregiver', header: 'Caregiver', cell: caregiverLink },
  { key: 'requirement', header: 'Requirement', cell: (item) => item.requirementName },
  { key: 'stopped', header: 'Stopped', cell: (item) => (item.stoppedAt === null ? '—' : DATE.format(item.stoppedAt)) },
  { key: 'step', header: 'Step', cell: (item) => REVIEW_STEP_COPY[item.step] },
  { key: 'attempts', header: 'Attempts', align: 'end', cell: (item) => item.attempts },
]

const SIGNING_COLUMNS: ReadonlyArray<Column<StalledSigning>> = [
  { key: 'caregiver', header: 'Caregiver', cell: caregiverLink },
  { key: 'stopped', header: 'Stopped', cell: (item) => (item.stoppedAt === null ? '—' : DATE.format(item.stoppedAt)) },
  { key: 'step', header: 'Step', cell: (item) => SIGNING_STEP_COPY[item.step] },
  { key: 'attempts', header: 'Attempts', align: 'end', cell: (item) => item.attempts },
]

function retryColumn<T extends { jobId: string }>(): Column<T> {
  return { key: 'retry', header: 'Retry', align: 'end', cell: (item) => <RetryForm jobId={item.jobId} /> }
}

export default async function ExceptionQueuePage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a supervisor is not told the page exists.
  if (!can(principal, 'exceptionQueue.view')) notFound()

  const queue = await runAsPrincipal(principal, {}, () => getExceptionQueue({}))
  const canDecide = can(principal, 'exceptionQueue.decide')
  const canWaive = can(principal, 'requirement.waive')
  const needsDecision = queue.flagged.filter((item) => item.returned === null)
  const waiting = queue.flagged.filter((item): item is Returned => item.returned !== null)

  const flaggedColumns: ReadonlyArray<Column<FlaggedDocument>> = canDecide
    ? [
        ...FLAGGED_COLUMNS,
        {
          key: 'decide',
          header: 'Decision',
          cell: (item) => (
            <DecideException
              instanceId={item.instanceId}
              uploadedDocumentId={item.uploadedDocumentId}
              caregiverName={item.caregiverName}
              requirementName={item.requirementName}
              decisions={canWaive ? QUEUE_DECISIONS : STAFF_DECISIONS}
              trigger="Decide"
            />
          ),
        },
      ]
    : FLAGGED_COLUMNS
  const waitingColumns: ReadonlyArray<Column<Returned>> = [
    { key: 'caregiver', header: 'Caregiver', cell: caregiverLink },
    { key: 'requirement', header: 'Requirement', cell: (item) => item.requirementName },
    { key: 'returned', header: 'Returned', cell: (item) => DATE.format(item.returned.decidedAt) },
    { key: 'askedFor', header: 'Asked for', cell: (item) => RETURN_COPY[item.returned.decision] },
    { key: 'email', header: 'Email', cell: (item) => <NoticeCell returned={item.returned} canRetry={canDecide} /> },
    ...(canWaive
      ? [
          {
            key: 'waive',
            header: 'Waive',
            cell: (item: Returned) => (
              <DecideException
                instanceId={item.instanceId}
                uploadedDocumentId={item.uploadedDocumentId}
                caregiverName={item.caregiverName}
                requirementName={item.requirementName}
                decisions={['WAIVED']}
                trigger="Waive"
              />
            ),
          },
        ]
      : []),
  ]
  const stalledColumns = canDecide ? [...STALLED_COLUMNS, retryColumn<StalledReview>()] : STALLED_COLUMNS
  const signingColumns = canDecide ? [...SIGNING_COLUMNS, retryColumn<StalledSigning>()] : SIGNING_COLUMNS

  return (
    <>
      <PageHeader
        title="Exception queue"
        description="Documents automatic review sent to staff, with what failed and the judge's reasoning."
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="flagged">
          <h2 id="flagged" className="mb-2 text-base font-semibold text-ink">
            Needs a decision ({needsDecision.length})
          </h2>
          <DataTable
            caption="Flagged documents"
            columns={flaggedColumns}
            rows={needsDecision}
            getRowKey={(item) => item.instanceId}
            empty={<p className="text-sm text-ink-muted">No documents need a decision.</p>}
          />
        </section>
        <section aria-labelledby="waiting">
          <h2 id="waiting" className="mb-2 text-base font-semibold text-ink">
            Waiting on the caregiver ({waiting.length})
          </h2>
          <DataTable
            caption="Returned documents"
            columns={waitingColumns}
            rows={waiting}
            getRowKey={(item) => item.instanceId}
            empty={<p className="text-sm text-ink-muted">No documents are waiting on a caregiver.</p>}
          />
        </section>
        <section aria-labelledby="stalled">
          <h2 id="stalled" className="mb-2 text-base font-semibold text-ink">
            Automatic review stopped ({queue.stalled.length})
          </h2>
          <DataTable
            caption="Stopped reviews"
            columns={stalledColumns}
            rows={queue.stalled}
            getRowKey={(item) => item.jobId}
            empty={<p className="text-sm text-ink-muted">No reviews have stopped.</p>}
          />
        </section>
        <section aria-labelledby="signing">
          <h2 id="signing" className="mb-2 text-base font-semibold text-ink">
            E-signature stopped ({queue.stalledSigning.length})
          </h2>
          <DataTable
            caption="Stopped e-signature steps"
            columns={signingColumns}
            rows={queue.stalledSigning}
            getRowKey={(item) => item.jobId}
            empty={<p className="text-sm text-ink-muted">No e-signature steps have stopped.</p>}
          />
        </section>
      </div>
    </>
  )
}
