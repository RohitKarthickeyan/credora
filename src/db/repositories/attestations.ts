import { runInAuditedTransaction } from '../audit'

export function createAttestation(agencyId: string, caregiverId: string): Promise<{ readonly id: string }> {
  return runInAuditedTransaction((tx) =>
    tx.attestation.create({ data: { agencyId, caregiverId }, select: { id: true } }),
  )
}
