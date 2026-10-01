import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Sensitive } from '@/app/_components/sensitive'
import {
  ENVELOPE_STATUS_PRESENTATION,
  INVITE_STATUS_PRESENTATION,
  PIPELINE_STAGE_PRESENTATION,
  REQUIREMENT_STATUS_PRESENTATION,
} from '@/app/_lib/status'
import type { InviteCancelReason } from '@/domain/pipeline/invite'
import { isTerminal } from '@/domain/pipeline/transitions'
import { awaitsHealthScreeningResult } from '@/domain/requirements/health-screening'
import { formatPhone } from '@/domain/validation/phone'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getCaregiverDetail } from '@/server/caregivers/caregiver-detail'
import { getClearanceSheet } from '@/server/clearance/clearance-sheet'
import { viewConversation } from '@/server/conversation/staff'
import { isFirstAlayaCareSyncPending } from '@/server/sync/alayacare-preview'
import { Alert } from '@/ui/alert'
import { Card } from '@/ui/card'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'
import { WithdrawCaregiver } from '../../pipeline/withdraw-caregiver'
import { revealSensitiveFieldAction } from './actions'
import { CompleteBackgroundCheck } from './complete-background-check'
import { Conversation } from './conversation'
import { CorrectEmail } from './correct-email'
import { RecordHealthScreeningResult } from './record-health-screening-result'
import { ResendInvite } from './resend-invite'
import { SignOffClearance } from './sign-off-clearance'
import { VoidEnvelope } from './void-envelope'

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

const CANCEL_REASON_COPY: Record<InviteCancelReason, string> = {
  WITHDRAWN: 'Cancelled because the caregiver was withdrawn.',
  ALREADY_STARTED: 'Not needed: the caregiver had already signed in.',
  NO_EMAIL: 'Cancelled: no email on record.',
}

const REQUIREMENT_COLUMNS: ReadonlyArray<Column<Requirement>> = [
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

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`
}

export default async function CaregiverPage(props: PageProps<'/caregivers/[id]'>) {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a role without access is not told the page exists.
  if (!can(principal, 'caregiver.view')) notFound()

  const { id } = await props.params
  const detail = await runAsPrincipal(principal, {}, () => getCaregiverDetail({ caregiverId: id }))
  if (detail === null) notFound()
  const sheet = await runAsPrincipal(principal, {}, () => getClearanceSheet({ caregiverId: id }))
  if (sheet === null) notFound()

  const { latestInvite, latestEnvelope } = detail
  const conversation = can(principal, 'conversation.manage')
    ? await runAsPrincipal(principal, {}, () => viewConversation({ caregiverId: id }))
    : null
  const firstSyncPending =
    (sheet.stage === 'CLEARANCE' || sheet.stage === 'SYNCING') &&
    (await runAsPrincipal(principal, {}, () => isFirstAlayaCareSyncPending({})))

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
  const requirementColumns: ReadonlyArray<Column<Requirement>> = [
    ...REQUIREMENT_COLUMNS,
    { key: 'result', header: 'Result', cell: result },
  ]

  return (
    <>
      <PageHeader
        title={detail.name ?? 'Name not yet provided'}
        description={`${PIPELINE_STAGE_PRESENTATION[detail.stage].label} · ${days(detail.daysInStage)} in stage`}
        back={{ href: '/pipeline', label: 'Back to the pipeline' }}
        actions={
          can(principal, 'caregiver.withdraw') && !isTerminal(detail.stage) ? (
            <WithdrawCaregiver caregiverId={detail.caregiverId} name={detail.name} />
          ) : null
        }
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="requirements" className="flex flex-col gap-3">
          <h2 id="requirements" className="text-base font-semibold text-ink">
            Requirements
          </h2>
          <ReadinessAlert readiness={sheet.readiness} />
          {firstSyncPending ? (
            <Alert tone="neutral" title="This agency has not synced to AlayaCare yet">
              {/* The preview writes a VIEW, so it is not prefetched (ADR-094). */}
              <Link href={`/caregivers/${id}/alayacare`} prefetch={false} className="font-medium text-brand-700">
                Preview what the sync will send
              </Link>
            </Alert>
          ) : null}
          <DataTable
            caption="Requirements"
            columns={requirementColumns}
            rows={sheet.requirements}
            getRowKey={(requirement) => requirement.templateKey}
          />
        </section>

        {can(principal, 'clearance.signOff') ? (
          <section aria-labelledby="sign-off" className="flex flex-col items-start gap-3">
            <h2 id="sign-off" className="text-base font-semibold text-ink">
              Sign-off
            </h2>
            <SignOffBody sheet={sheet} />
          </section>
        ) : null}

        {detail.workState === 'DEMO' &&
        detail.stage === 'VERIFICATION' &&
        can(principal, 'backgroundCheck.complete') ? (
          <CompleteBackgroundCheck caregiverId={detail.caregiverId} />
        ) : null}

        {conversation === null ? null : (
          <Card
            title="Conversation"
            action={
              process.env.NODE_ENV !== 'production' ? (
                <Link
                  href={`/dev/phone/${detail.caregiverId}`}
                  className="text-sm font-medium text-brand-700 underline"
                >
                  Open phone
                </Link>
              ) : null
            }
          >
            <Conversation
              caregiverId={detail.caregiverId}
              paused={conversation.paused}
              handedOff={conversation.handedOff}
              needsReply={conversation.needsReply}
              messages={conversation.messages.map((message) => ({
                id: message.id,
                fromCaregiver: message.direction === 'INBOUND',
                author: message.author,
                body: message.body,
                hasMedia: message.mediaStorageKey !== null,
              }))}
            />
          </Card>
        )}

        <section aria-labelledby="contact" className="flex flex-col gap-3">
          <h2 id="contact" className="text-base font-semibold text-ink">
            Contact
          </h2>
          <dl className="grid gap-3 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
            <dt className="text-sm text-ink-muted">Mobile</dt>
            <dd>
              {detail.mobilePhone === null ? 'Not provided' : formatPhone(detail.mobilePhone)}
            </dd>
            <dt className="text-sm text-ink-muted">Sign-in email</dt>
            <dd className="flex flex-wrap items-center gap-3">
              <span className="break-all">{detail.email ?? 'Not provided'}</span>
              {can(principal, 'caregiver.correctEmail') ? (
                <CorrectEmail caregiverId={detail.caregiverId} />
              ) : null}
            </dd>
          </dl>
        </section>

        {can(principal, 'caregiverField.reveal') ? (
          <section aria-labelledby="sensitive" className="flex flex-col gap-3">
            <h2 id="sensitive" className="text-base font-semibold text-ink">
              Sensitive details
            </h2>
            <Sensitive
              field="ssn"
              last4={detail.ssnLast4}
              label="Social Security number"
              caregiverId={detail.caregiverId}
              reveal={revealSensitiveFieldAction}
            />
            <Sensitive
              field="bankAccountNumber"
              last4={detail.bankAccountLast4}
              label="Bank account number"
              caregiverId={detail.caregiverId}
              reveal={revealSensitiveFieldAction}
            />
            <Sensitive
              field="bankRoutingNumber"
              label="Bank routing number"
              caregiverId={detail.caregiverId}
              reveal={revealSensitiveFieldAction}
            />
            <Sensitive
              field="workAuthorizationNumber"
              label="Work authorization number"
              caregiverId={detail.caregiverId}
              reveal={revealSensitiveFieldAction}
            />
          </section>
        ) : null}

        <section aria-labelledby="invite" className="flex flex-col items-start gap-3">
          <h2 id="invite" className="text-base font-semibold text-ink">
            Invite
          </h2>
          {latestInvite === null ? (
            <p className="text-ink-muted">No invite on record.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge {...INVITE_STATUS_PRESENTATION[latestInvite.status]} />
                {DATE.format(latestInvite.at)}
              </p>
              {latestInvite.cancelReason !== null ? (
                <p>{CANCEL_REASON_COPY[latestInvite.cancelReason]}</p>
              ) : null}
              {latestInvite.status === 'REJECTED' ? (
                <p>The email provider refused this address. Correct the email, then resend.</p>
              ) : null}
            </>
          )}
          {detail.stage === 'INVITED' && can(principal, 'caregiver.invite') ? (
            <ResendInvite caregiverId={detail.caregiverId} />
          ) : null}
        </section>

        <section aria-labelledby="esignature" className="flex flex-col items-start gap-3">
          <h2 id="esignature" className="text-base font-semibold text-ink">
            E-signature
          </h2>
          {latestEnvelope === null ? (
            <p className="text-ink-muted">Not prepared yet.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge {...ENVELOPE_STATUS_PRESENTATION[latestEnvelope.status]} />
                {DATE.format(latestEnvelope.at)}
              </p>
              {latestEnvelope.status === 'DECLINED' || latestEnvelope.status === 'VOIDED' ? (
                <p>The caregiver can prepare a new set from their signing page.</p>
              ) : null}
              {latestEnvelope.status === 'SENT' && can(principal, 'envelope.void') ? (
                <VoidEnvelope caregiverId={detail.caregiverId} />
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  )
}
