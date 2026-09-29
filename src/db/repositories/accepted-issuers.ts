import {
  type AcceptedIssuer,
  type AcceptedIssuerInput,
  type AcceptedIssuerWriteResult,
  acceptedIssuerInputSchema,
  matchAcceptedIssuer,
} from '@/domain/documents/accepted-issuer'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '../audit'
import type { AcceptedIssuerModel } from '../generated/models/AcceptedIssuer'
import { prisma } from '../prisma'

const NOT_FOUND = { ok: false, reason: 'NOT_FOUND' } as const
const DUPLICATE_NAME = { ok: false, reason: 'DUPLICATE_NAME' } as const

function toAcceptedIssuer(row: AcceptedIssuerModel): AcceptedIssuer {
  return { id: row.id, name: row.name, kind: row.kind }
}

async function isDuplicate(
  tx: AuditedTx,
  agencyId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const live = await tx.acceptedIssuer.findMany({
    where: { agencyId, retiredAt: null, id: excludeId === undefined ? undefined : { not: excludeId } },
  })
  return matchAcceptedIssuer(name, live.map(toAcceptedIssuer)) !== null
}

function findLiveRow(tx: AuditedTx, agencyId: string, id: string) {
  return tx.acceptedIssuer.findFirst({ where: { id, agencyId, retiredAt: null } })
}

export async function findLiveAcceptedIssuers(agencyId: string): Promise<readonly AcceptedIssuer[]> {
  const rows = await prisma.acceptedIssuer.findMany({
    where: { agencyId, retiredAt: null },
    orderBy: { name: 'asc' },
  })
  return rows.map(toAcceptedIssuer)
}

export function createAcceptedIssuer(
  agencyId: string,
  input: AcceptedIssuerInput,
): Promise<AcceptedIssuerWriteResult> {
  const data = acceptedIssuerInputSchema.parse(input)

  return runInAuditedTransaction(async (tx) => {
    if (await isDuplicate(tx, agencyId, data.name)) return DUPLICATE_NAME

    const row = await tx.acceptedIssuer.create({ data: { agencyId, ...data } })
    // No name or kind: SECURITY.md § Audit log stores that something was touched, never a value.
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'ACCEPTED_ISSUER',
      entityId: row.id,
    })
    return { ok: true, issuer: toAcceptedIssuer(row) }
  })
}

export function updateAcceptedIssuer(
  agencyId: string,
  id: string,
  input: AcceptedIssuerInput,
): Promise<AcceptedIssuerWriteResult> {
  const data = acceptedIssuerInputSchema.parse(input)

  return runInAuditedTransaction(async (tx) => {
    // Another agency's id is NOT_FOUND rather than forbidden, so a caller learns nothing about
    // which ids exist.
    if ((await findLiveRow(tx, agencyId, id)) === null) return NOT_FOUND
    if (await isDuplicate(tx, agencyId, data.name, id)) return DUPLICATE_NAME

    const row = await tx.acceptedIssuer.update({ where: { id }, data })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'ACCEPTED_ISSUER',
      entityId: row.id,
    })
    return { ok: true, issuer: toAcceptedIssuer(row) }
  })
}

export function retireAcceptedIssuer(
  agencyId: string,
  id: string,
  now: Date,
): Promise<AcceptedIssuerWriteResult> {
  return runInAuditedTransaction(async (tx) => {
    if ((await findLiveRow(tx, agencyId, id)) === null) return NOT_FOUND

    // Retired, never deleted: an entry that once let a document skip the judge must stay
    // resolvable for the weekly sample and the audit.
    const row = await tx.acceptedIssuer.update({ where: { id }, data: { retiredAt: now } })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'ACCEPTED_ISSUER',
      entityId: row.id,
      fieldName: 'retiredAt',
    })
    return { ok: true, issuer: toAcceptedIssuer(row) }
  })
}
