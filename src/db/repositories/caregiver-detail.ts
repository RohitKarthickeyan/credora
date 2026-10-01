import type { EnvelopeStatus } from '@/domain/documents/envelope'
import type { InviteStatus } from '@/domain/pipeline/invite'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { AuditedTx } from '../audit'

type CaregiverDetailRow = {
  readonly caregiverId: string
  readonly stage: PipelineStage
  readonly workState: string | null
  readonly createdAt: Date
  readonly lastTransitionAt: Date | null
  readonly legalFirstName: string | null
  readonly legalLastName: string | null
  readonly ssnLast4: string | null
  readonly bankAccountLast4: string | null
  readonly mobilePhone: string | null
  readonly email: string | null
  readonly latestInvite: {
    readonly status: InviteStatus
    readonly reason: string | null
    readonly createdAt: Date
    readonly settledAt: Date | null
  } | null
  readonly latestEnvelope: {
    readonly status: EnvelopeStatus
    readonly createdAt: Date
    readonly signedAt: Date | null
  } | null
}

// Identity and payroll are sensitive-tier: only plaintext columns are selected, never an `*Enc`
// one. AuditedTx has no restricted delegate and Caregiver no relation to one, so medical and EEOC
// data cannot be reached from here (OPEN-QUESTIONS 155 lists what the record shows).
export async function findCaregiverDetail(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<CaregiverDetailRow | null> {
  const row = await tx.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: {
      id: true,
      stage: true,
      workState: true,
      createdAt: true,
      identity: { select: { legalFirstName: true, legalLastName: true, ssnLast4: true } },
      payrollInputs: { select: { bankAccountLast4: true } },
      contact: { select: { mobilePhone: true, email: true } },
      pipelineEvents: {
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { occurredAt: true },
      },
      invites: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true, reason: true, createdAt: true, settledAt: true },
      },
      envelopes: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true, createdAt: true, signedAt: true },
      },
    },
  })
  if (row === null) return null

  return {
    caregiverId: row.id,
    stage: row.stage,
    workState: row.workState,
    createdAt: row.createdAt,
    lastTransitionAt: row.pipelineEvents[0]?.occurredAt ?? null,
    legalFirstName: row.identity?.legalFirstName ?? null,
    legalLastName: row.identity?.legalLastName ?? null,
    ssnLast4: row.identity?.ssnLast4 ?? null,
    bankAccountLast4: row.payrollInputs?.bankAccountLast4 ?? null,
    mobilePhone: row.contact?.mobilePhone ?? null,
    email: row.contact?.email ?? null,
    latestInvite: row.invites[0] ?? null,
    latestEnvelope: row.envelopes[0] ?? null,
  }
}
