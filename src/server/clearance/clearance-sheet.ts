import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findClearanceSheet } from '@/db/repositories/clearance'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { BlockerCandidate } from '@/domain/requirements/blocker'
import { type ClearanceReadiness, clearanceReadiness } from '@/domain/requirements/clearance'
import type { UseCase } from '@/server/auth/policy'
import { can, defineUseCase } from '@/server/auth/policy'

type ClearanceEvidence =
  | {
      readonly kind: 'SIGNED_DOCUMENT'
      readonly label: string
      readonly at: Date
      readonly templateVersion: string
    }
  | {
      readonly kind: 'UPLOADED_DOCUMENT' | 'CHECK_RESULT' | 'ATTESTATION' | 'TRAINING_RECORD'
      readonly label: string
      readonly at: Date
    }

type ClearanceRequirement = BlockerCandidate & {
  readonly instanceId: string
  readonly resultedOn: string | null
  readonly evidence: readonly ClearanceEvidence[]
}

type ClearanceSheet = {
  readonly caregiverId: string
  readonly name: string | null
  readonly stage: PipelineStage
  readonly readiness: ClearanceReadiness<ClearanceRequirement>
  readonly requirements: readonly ClearanceRequirement[]
}

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// One VIEW per open of a found record, none for an id that is not this agency's (ADR-094). Signed
// copies are read after the transaction through the T-064 path, which uses the global client.
export const getClearanceSheet: UseCase<{ readonly caregiverId: string }, ClearanceSheet | null> =
  defineUseCase('clearance.view', async ({ principal, input }) => {
    const row = await runInAuditedTransaction(async (tx) => {
      const sheet = await findClearanceSheet(tx, principal.agencyId, input.caregiverId)
      if (sheet === null) return null

      await writeAuditEntry(tx, {
        agencyId: principal.agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: sheet.caregiverId,
      })
      return sheet
    })
    if (row === null) return null

    // clearance.view includes the agency admin, who holds no medical result.
    const showsResults = can(principal, 'medicalResult.view')
    const signed = new Map(
      (await findSignedDocuments(principal.agencyId, row.caregiverId)).map((doc) => [doc.id, doc]),
    )
    const requirements: readonly ClearanceRequirement[] = row.requirements.map((requirement) => ({
      ...requirement,
      resultedOn: showsResults ? requirement.resultedOn : null,
      evidence: requirement.evidence.map((evidence): ClearanceEvidence => {
        if (evidence.kind !== 'SIGNED_DOCUMENT') return evidence
        const doc = signed.get(evidence.signedDocumentId)
        if (doc === undefined) throw new Error(`Signed document ${evidence.signedDocumentId} not found.`)
        return {
          kind: 'SIGNED_DOCUMENT',
          label: evidence.label,
          at: doc.signedAt,
          templateVersion: doc.templateVersion,
        }
      }),
    }))

    const nameParts = [row.legalFirstName, row.legalLastName].filter((part) => part !== null)
    return {
      caregiverId: row.caregiverId,
      name: nameParts.length === 0 ? null : nameParts.join(' '),
      stage: row.stage,
      readiness: clearanceReadiness(requirements),
      requirements,
    }
  })
