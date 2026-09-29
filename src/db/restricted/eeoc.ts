import type { EeocAggregateReport } from '@/domain/eeoc/aggregate-report'
import { buildEeocAggregateReport } from '@/domain/eeoc/aggregate-report'
import type { EeocSelfIdentificationInput } from '@/domain/eeoc/self-identification'
import { eeocSelfIdentificationInputSchema } from '@/domain/eeoc/self-identification'
import type { AuditedTx } from '../audit'
import { runInAuditedTransaction, writeAuditEntry } from '../audit'
import type { PrismaTransactionClient } from '../prisma'

// AuditedTx omits the restricted delegates so that no use case outside this directory can
// reach the medical or EEOC store (ADR-002). These accessors are the one place that may, so
// they widen it here; the widened type is not exported and cannot travel.
type RestrictedTx = PrismaTransactionClient & AuditedTx

export async function deleteEeocRecord(agencyId: string, caregiverId: string): Promise<void> {
  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    await tx.eeocRecord.deleteMany({ where: { agencyId, caregiverId } })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'DELETE',
      entityType: 'EEOC_RECORD',
      entityId: caregiverId,
    })
  })
}

// Nothing in this module returns one caregiver's answers, to anyone (SECURITY.md: "EEOC data is
// visible to no role in the UI"). The writer returns void so it cannot become a read channel.
export async function saveEeocSelfIdentification(
  agencyId: string,
  caregiverId: string,
  input: EeocSelfIdentificationInput,
): Promise<void> {
  const { gender, raceEthnicity } = eeocSelfIdentificationInputSchema.parse(input)
  // A blank answer is stored as null, so a resubmission that leaves a question blank clears it.
  const data = {
    gender: gender ?? null,
    raceEthnicity: raceEthnicity ?? null,
    submittedAt: new Date(),
  }

  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    // caregiverId is unique on its own, so the row is found by both keys rather than upserted on
    // caregiverId alone, which could reach another agency's row.
    const existing = await tx.eeocRecord.findFirst({ where: { agencyId, caregiverId } })
    if (existing === null) await tx.eeocRecord.create({ data: { agencyId, caregiverId, ...data } })
    else await tx.eeocRecord.update({ where: { id: existing.id }, data })

    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'EEOC_RECORD',
      entityId: caregiverId,
    })
  })
}

/** Whether the voluntary form was submitted, so it is not offered again. Never what it said. */
export function hasEeocResponse(agencyId: string, caregiverId: string): Promise<boolean> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const count = await tx.eeocRecord.count({ where: { agencyId, caregiverId } })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'EEOC_RECORD',
      entityId: caregiverId,
    })
    return count > 0
  })
}

// Suppression runs here, before return, so the unsuppressed counts never leave this directory. One
// groupBy rather than one per column, so both marginals are counted from the same snapshot.
export function readEeocAggregateReport(agencyId: string): Promise<EeocAggregateReport> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const rows = await tx.eeocRecord.groupBy({
      by: ['gender', 'raceEthnicity'],
      where: { agencyId },
      _count: { _all: true },
    })
    const report = buildEeocAggregateReport(
      rows.map((row) => ({ gender: row.gender, raceEthnicity: row.raceEthnicity, count: row._count._all })),
    )
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'EEOC_RECORD',
      entityId: agencyId,
    })
    return report
  })
}
