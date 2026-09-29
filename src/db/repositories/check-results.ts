import { runInAuditedTransaction } from '../audit'

export function createCheckResult(
  agencyId: string,
  caregiverId: string,
  recordedByUserId: string | null,
): Promise<{ readonly id: string }> {
  return runInAuditedTransaction((tx) =>
    tx.checkResult.create({ data: { agencyId, caregiverId, recordedByUserId }, select: { id: true } }),
  )
}
