import type { InviteCancelReason, InviteCaregiverInput, InviteStatus } from '@/domain/pipeline/invite'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { AuditedTx } from '../audit'
import { prisma } from '../prisma'

/**
 * The caregiver at INVITED with its resolution context, legal name, sign-in email, and one QUEUED
 * invite. No home-care profile or payroll row:
 * nothing here has a value for them, and their owners create them on first save.
 */
export async function createInvitedCaregiver(
  tx: AuditedTx,
  agencyId: string,
  input: InviteCaregiverInput,
): Promise<{ readonly caregiverId: string; readonly inviteId: string }> {
  const caregiver = await tx.caregiver.create({
    data: {
      agencyId,
      workState: input.workState,
      serviceType: input.serviceType,
      payer: input.payer,
      identity: {
        create: { legalFirstName: input.legalFirstName, legalLastName: input.legalLastName },
      },
      contact: { create: { email: input.email } },
      invites: { create: {} },
    },
    select: { id: true, invites: { select: { id: true } } },
  })

  const [invite] = caregiver.invites
  if (invite === undefined) throw new Error('The nested invite create returned no row.')
  return { caregiverId: caregiver.id, inviteId: invite.id }
}

// Agency-scoped on purpose (T-044 § Questions 1): telling one agency that another tenant's
// caregiver holds the address would disclose that caregiver.
export async function isEmailInUse(
  tx: AuditedTx,
  agencyId: string,
  email: string,
): Promise<boolean> {
  const count = await tx.contactRecord.count({
    where: { agencyId, email, caregiver: { stage: { not: 'WITHDRAWN' } } },
  })
  return count > 0
}

// For the demo seed: unlike isEmailInUse it counts withdrawn caregivers, because a withdrawn demo
// caregiver is still that demo caregiver.
export async function hasCaregiverWithEmail(agencyId: string, email: string): Promise<boolean> {
  const count = await prisma.contactRecord.count({ where: { agencyId, email } })
  return count > 0
}

type InviteForSend = {
  readonly status: InviteStatus
  readonly caregiverId: string
  readonly stage: PipelineStage
  readonly email: string | null
  readonly agencyName: string
}

export async function findInviteForSend(
  tx: AuditedTx,
  agencyId: string,
  inviteId: string,
): Promise<InviteForSend | null> {
  const row = await tx.invite.findFirst({
    where: { id: inviteId, agencyId },
    select: {
      status: true,
      caregiverId: true,
      caregiver: {
        select: {
          stage: true,
          contact: { select: { email: true } },
          agency: { select: { name: true } },
        },
      },
    },
  })
  if (row === null) return null

  return {
    status: row.status,
    caregiverId: row.caregiverId,
    stage: row.caregiver.stage,
    email: row.caregiver.contact?.email ?? null,
    agencyName: row.caregiver.agency.name,
  }
}

type InviteOutcome =
  | { readonly status: 'SENT' }
  | { readonly status: 'REJECTED'; readonly reason: string }
  | { readonly status: 'CANCELLED'; readonly reason: InviteCancelReason }

/** Settles a QUEUED invite exactly once; false when it had already left QUEUED. */
export async function recordInviteOutcome(
  tx: AuditedTx,
  agencyId: string,
  inviteId: string,
  outcome: InviteOutcome,
  now: Date,
): Promise<boolean> {
  const { count } = await tx.invite.updateMany({
    where: { id: inviteId, agencyId, status: 'QUEUED' },
    data: {
      status: outcome.status,
      reason: outcome.status === 'SENT' ? null : outcome.reason,
      settledAt: now,
    },
  })
  return count === 1
}

export async function findInviteLanding(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<{ readonly agencyName: string } | null> {
  const row = await tx.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: { agency: { select: { name: true } } },
  })
  return row === null ? null : { agencyName: row.agency.name }
}

type InviteResendState = {
  readonly stage: PipelineStage
  readonly email: string | null
  readonly latestInviteStatus: InviteStatus | null
}

export async function findInviteResendState(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<InviteResendState | null> {
  const row = await tx.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: {
      stage: true,
      contact: { select: { email: true } },
      invites: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true },
      },
    },
  })
  if (row === null) return null

  return {
    stage: row.stage,
    email: row.contact?.email ?? null,
    latestInviteStatus: row.invites[0]?.status ?? null,
  }
}

export async function createInvite(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<{ readonly inviteId: string }> {
  const invite = await tx.invite.create({ data: { agencyId, caregiverId }, select: { id: true } })
  return { inviteId: invite.id }
}
