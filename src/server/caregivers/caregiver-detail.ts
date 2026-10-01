import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findCaregiverDetail } from '@/db/repositories/caregiver-detail'
import type { EnvelopeStatus } from '@/domain/documents/envelope'
import { daysInStage } from '@/domain/pipeline/board'
import type { InviteCancelReason, InviteStatus } from '@/domain/pipeline/invite'
import { INVITE_CANCEL_REASONS } from '@/domain/pipeline/invite'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { BlockerCandidate, CurrentBlocker } from '@/domain/requirements/blocker'
import { currentBlocker } from '@/domain/requirements/blocker'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

type CaregiverDetail = {
  readonly caregiverId: string
  readonly name: string | null
  readonly stage: PipelineStage
  readonly workState: string | null
  readonly daysInStage: number
  readonly blocker: CurrentBlocker | null
  readonly requirements: readonly BlockerCandidate[]
  readonly ssnLast4: string | null
  readonly bankAccountLast4: string | null
  readonly mobilePhone: string | null
  readonly email: string | null
  readonly latestInvite: {
    readonly status: InviteStatus
    readonly cancelReason: InviteCancelReason | null
    readonly at: Date
  } | null
  readonly latestEnvelope: { readonly status: EnvelopeStatus; readonly at: Date } | null
}

const cancelReasonSchema = z.enum(INVITE_CANCEL_REASONS)

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// One VIEW per open of a found record, none for an id that is not this agency's (ADR-094). A
// REJECTED invite's vendor reason is not returned: it is vendor jargon.
export const getCaregiverDetail: UseCase<{ readonly caregiverId: string }, CaregiverDetail | null> =
  defineUseCase('caregiver.view', async ({ principal, input }) =>
    runInAuditedTransaction(async (tx) => {
      const row = await findCaregiverDetail(tx, principal.agencyId, input.caregiverId)
      if (row === null) return null

      await writeAuditEntry(tx, {
        agencyId: principal.agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: row.caregiverId,
      })

      const nameParts = [row.legalFirstName, row.legalLastName].filter((part) => part !== null)
      const invite = row.latestInvite
      const envelope = row.latestEnvelope
      return {
        caregiverId: row.caregiverId,
        name: nameParts.length === 0 ? null : nameParts.join(' '),
        stage: row.stage,
        workState: row.workState,
        daysInStage: daysInStage(row, new Date()),
        blocker: currentBlocker(row.instances),
        requirements: row.instances,
        ssnLast4: row.ssnLast4,
        bankAccountLast4: row.bankAccountLast4,
        mobilePhone: row.mobilePhone,
        email: row.email,
        latestInvite:
          invite === null
            ? null
            : {
                status: invite.status,
                cancelReason:
                  invite.status === 'CANCELLED' ? cancelReasonSchema.parse(invite.reason) : null,
                at: invite.settledAt ?? invite.createdAt,
              },
        latestEnvelope:
          envelope === null
            ? null
            : { status: envelope.status, at: envelope.signedAt ?? envelope.createdAt },
      }
    }),
  )
