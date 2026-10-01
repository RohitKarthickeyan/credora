import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Sensitive } from '@/app/_components/sensitive'
import {
  ENVELOPE_STATUS_PRESENTATION,
  INVITE_STATUS_PRESENTATION,
  PIPELINE_STAGE_PRESENTATION,
  REQUIREMENT_STATUS_PRESENTATION,
} from '@/app/_lib/status'
import type { InviteCancelReason } from '@/domain/pipeline/invite'
import { isTerminal } from '@/domain/pipeline/transitions'
import type { BlockerCandidate } from '@/domain/requirements/blocker'
import { formatPhone } from '@/domain/validation/phone'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { getCaregiverDetail } from '@/server/caregivers/caregiver-detail'
import { viewConversation } from '@/server/conversation/staff'
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
import { ResendInvite } from './resend-invite'
import { VoidEnvelope } from './void-envelope'

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })

const CANCEL_REASON_COPY: Record<InviteCancelReason, string> = {
  WITHDRAWN: 'Cancelled because the caregiver was withdrawn.',
  ALREADY_STARTED: 'Not needed: the caregiver had already signed in.',
  NO_EMAIL: 'Cancelled: no email on record.',
}

const REQUIREMENT_COLUMNS: ReadonlyArray<Column<BlockerCandidate>> = [
  { key: 'name', header: 'Requirement', cell: (instance) => instance.name },
  {
    key: 'status',
    header: 'Status',
    cell: (instance) => (
      <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[instance.status]} size="sm" />
    ),
  },
  {
    key: 'blocksClearance',
    header: 'Blocks clearance',
    cell: (instance) => (instance.blocksClearance ? 'Yes' : 'No'),
  },
]

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`
}

export default async function CaregiverPage(props: PageProps<'/caregivers/[id]'>) {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a supervisor is not told the page exists.
  if (!can(principal, 'caregiver.view')) notFound()

  const { id } = await props.params
  const detail = await runAsPrincipal(principal, {}, () => getCaregiverDetail({ caregiverId: id }))
  if (detail === null) notFound()

  const { blocker, latestInvite, latestEnvelope } = detail
  const conversation = can(principal, 'conversation.manage')
    ? await runAsPrincipal(principal, {}, () => viewConversation({ caregiverId: id }))
    : null

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
          <p className="flex flex-wrap items-center gap-2">
            Current blocker:
            {blocker === null ? (
              <span className="text-ink-muted">None outstanding</span>
            ) : (
              <>
                {blocker.blocker.name}
                <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[blocker.blocker.status]} size="sm" />
                {blocker.outstanding > 1 ? (
                  <span className="text-sm text-ink-muted">+{blocker.outstanding - 1} more</span>
                ) : null}
              </>
            )}
          </p>
          <DataTable
            caption="Requirements"
            columns={REQUIREMENT_COLUMNS}
            rows={detail.requirements}
            getRowKey={(instance) => instance.templateKey}
          />
        </section>

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

        {/* Not gated by can(): the roles that reach this page are exactly those of
            caregiverField.reveal, which cannot be asked without a reason. A divergence throws
            ForbiddenError on reveal, the safe direction. */}
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
