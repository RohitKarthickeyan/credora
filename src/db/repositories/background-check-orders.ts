import type { PipelineStage } from '@/domain/pipeline/stage'
import {
  BACKGROUND_CHECK_REQUIREMENT_KEY,
  type BackgroundCheckOrderStatus,
  type BackgroundCheckRow,
  fcraConsentOnFile,
} from '@/domain/requirements/background-check'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { type AuditedTx, runInAuditedTransaction } from '../audit'
import { fromDateColumn } from '../mapping/date-only'

type NameColumns = { readonly legalFirstName: string | null; readonly legalLastName: string | null } | null

// IdentityRecord is sensitive-tier: only the plaintext name and date-of-birth columns are selected.
const NAME_SELECT = { select: { legalFirstName: true, legalLastName: true } } as const
const SUBJECT_SELECT = { select: { legalFirstName: true, legalLastName: true, dateOfBirth: true } } as const

function displayName(identity: NameColumns): string | null {
  const parts = [identity?.legalFirstName ?? null, identity?.legalLastName ?? null].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
}

function subjectOf(
  identity: (NameColumns & { readonly dateOfBirth: Date | null }) | null,
): { readonly fullName: string; readonly dateOfBirth: string } | null {
  if (identity === null) return null
  const { legalFirstName, legalLastName, dateOfBirth } = identity
  if (legalFirstName === null || legalLastName === null || dateOfBirth === null) return null
  return { fullName: `${legalFirstName} ${legalLastName}`, dateOfBirth: fromDateColumn(dateOfBirth) }
}

export function findBackgroundCheckRows(agencyId: string): Promise<readonly BackgroundCheckRow[]> {
  return runInAuditedTransaction(async (tx) => {
    const rows = await tx.requirementInstance.findMany({
      where: { agencyId, templateKey: BACKGROUND_CHECK_REQUIREMENT_KEY, caregiver: { stage: { not: 'WITHDRAWN' } } },
      select: {
        id: true,
        caregiverId: true,
        status: true,
        caregiver: {
          select: {
            identity: NAME_SELECT,
            signedDocuments: { select: { templateKey: true } },
            backgroundCheckOrder: { select: { status: true, requestedAt: true } },
          },
        },
      },
    })

    return rows.map((row) => ({
      instanceId: row.id,
      caregiverId: row.caregiverId,
      caregiverName: displayName(row.caregiver.identity),
      status: row.status,
      fcraSigned: fcraConsentOnFile(row.caregiver.signedDocuments),
      order: row.caregiver.backgroundCheckOrder,
    }))
  })
}

export type BackgroundCheckSubject = {
  readonly caregiverId: string
  readonly caregiverStage: PipelineStage
  readonly status: InstanceStatus
  readonly ordered: boolean
  readonly orderStatus: BackgroundCheckOrderStatus | null
  readonly packageCode: string | null
  readonly subjectComplete: boolean
}

export function findBackgroundCheckSubject(
  agencyId: string,
  instanceId: string,
): Promise<BackgroundCheckSubject | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.requirementInstance.findFirst({
      where: { agencyId, id: instanceId, templateKey: BACKGROUND_CHECK_REQUIREMENT_KEY },
      select: {
        caregiverId: true,
        status: true,
        caregiver: {
          select: {
            stage: true,
            identity: SUBJECT_SELECT,
            backgroundCheckOrder: { select: { status: true } },
            agency: { select: { backgroundCheckPackageCode: true } },
          },
        },
      },
    })
    if (row === null) return null
    const order = row.caregiver.backgroundCheckOrder

    return {
      caregiverId: row.caregiverId,
      caregiverStage: row.caregiver.stage,
      status: row.status,
      ordered: order !== null,
      orderStatus: order?.status ?? null,
      packageCode: row.caregiver.agency.backgroundCheckPackageCode,
      subjectComplete: subjectOf(row.caregiver.identity) !== null,
    }
  })
}

export function createBackgroundCheckOrder(
  tx: AuditedTx,
  agencyId: string,
  input: { readonly caregiverId: string; readonly requestedByUserId: string; readonly packageCode: string },
): Promise<{ readonly id: string }> {
  return tx.backgroundCheckOrder.create({ data: { agencyId, ...input }, select: { id: true } })
}

export type OrderForPlacement = {
  readonly caregiverId: string
  readonly status: BackgroundCheckOrderStatus
  readonly packageCode: string
  readonly subject: { readonly fullName: string; readonly dateOfBirth: string } | null
}

export function findOrderForPlacement(agencyId: string, orderId: string): Promise<OrderForPlacement | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.backgroundCheckOrder.findFirst({
      where: { agencyId, id: orderId },
      select: {
        caregiverId: true,
        status: true,
        packageCode: true,
        caregiver: { select: { identity: SUBJECT_SELECT } },
      },
    })
    if (row === null) return null

    return {
      caregiverId: row.caregiverId,
      status: row.status,
      packageCode: row.packageCode,
      subject: subjectOf(row.caregiver.identity),
    }
  })
}

export async function recordVendorOrder(
  tx: AuditedTx,
  agencyId: string,
  orderId: string,
  vendorOrderId: string,
): Promise<boolean> {
  const { count } = await tx.backgroundCheckOrder.updateMany({
    where: { agencyId, id: orderId, status: 'REQUESTED', vendorOrderId: null },
    data: { vendorOrderId, status: 'ORDERED' },
  })
  return count === 1
}

export type OrderForReconcile = {
  readonly id: string
  readonly caregiverId: string
  readonly vendorOrderId: string | null
  readonly status: BackgroundCheckOrderStatus
  readonly instance: { readonly id: string; readonly status: InstanceStatus } | null
}

export function findOrderForReconcile(
  agencyId: string,
  by: { readonly id: string } | { readonly vendorOrderId: string },
): Promise<OrderForReconcile | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.backgroundCheckOrder.findFirst({
      where: { agencyId, ...by },
      select: {
        id: true,
        caregiverId: true,
        vendorOrderId: true,
        status: true,
        caregiver: {
          select: {
            requirementInstances: {
              where: { templateKey: BACKGROUND_CHECK_REQUIREMENT_KEY },
              select: { id: true, status: true },
            },
          },
        },
      },
    })
    if (row === null) return null

    return {
      id: row.id,
      caregiverId: row.caregiverId,
      vendorOrderId: row.vendorOrderId,
      status: row.status,
      instance: row.caregiver.requirementInstances[0] ?? null,
    }
  })
}

export async function advanceBackgroundCheckOrder(
  tx: AuditedTx,
  agencyId: string,
  orderId: string,
  change: {
    readonly from: BackgroundCheckOrderStatus
    readonly to: BackgroundCheckOrderStatus
    readonly resultAt: Date | null
  },
): Promise<boolean> {
  const { count } = await tx.backgroundCheckOrder.updateMany({
    where: { agencyId, id: orderId, status: change.from },
    data: { status: change.to, resultAt: change.resultAt },
  })
  return count === 1
}
