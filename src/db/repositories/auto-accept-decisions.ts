import type { AutoAcceptDecision, AutoAcceptOutcome } from '@/domain/documents/auto-accept'
import type { IdentityFinding, IdentityMatch } from '@/domain/identity/match'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import { runInAuditedTransaction } from '../audit'

function outcomeOf(identity: IdentityMatch, field: IdentityFinding['field']) {
  const finding = identity.findings.find((candidate) => candidate.field === field)
  if (finding === undefined) throw new Error(`Identity matching returned no ${field} finding.`)
  return finding.outcome
}

/** No audit entry: the job that decides writes it. */
export function saveAutoAcceptDecision(
  agencyId: string,
  decision: {
    readonly uploadedDocumentId: string
    readonly outcome: AutoAcceptOutcome
    readonly identity: IdentityMatch
    readonly instanceStatusSet: InstanceStatus | null
  },
): Promise<void> {
  const { uploadedDocumentId, outcome, identity, instanceStatusSet } = decision
  return runInAuditedTransaction(async (tx) => {
    await tx.autoAcceptDecision.create({
      data: {
        agencyId,
        uploadedDocumentId,
        staffReasons: outcome.kind === 'STAFF' ? [...outcome.reasons] : [],
        fullNameOutcome: outcomeOf(identity, 'fullName'),
        dateOfBirthOutcome: outcomeOf(identity, 'dateOfBirth'),
        instanceStatusSet,
      },
    })
  })
}

export function findAutoAcceptDecision(
  agencyId: string,
  uploadedDocumentId: string,
): Promise<AutoAcceptDecision | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.autoAcceptDecision.findFirst({ where: { agencyId, uploadedDocumentId } })
    if (row === null) return null
    return {
      uploadedDocumentId,
      outcome: row.staffReasons.length === 0 ? { kind: 'ACCEPT' } : { kind: 'STAFF', reasons: row.staffReasons },
      identity: { fullName: row.fullNameOutcome, dateOfBirth: row.dateOfBirthOutcome },
      instanceStatusSet: row.instanceStatusSet,
      decidedAt: row.decidedAt,
    }
  })
}
