import type {
  JudgeBasis,
  JudgeDecision,
  JudgeRequirement,
  JudgeStepOutcome,
} from '@/domain/documents/judge-review'
import { runInAuditedTransaction } from '../audit'
import type { JudgeDecisionModel } from '../generated/models/JudgeDecision'
import { readClinicalJudgeReasons, saveClinicalJudgeReasons } from '../restricted/medical'
import { isClinical } from './extractions'

export function findJudgeRequirement(agencyId: string, instanceId: string): Promise<JudgeRequirement> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.requirementInstance.findUnique({
      where: { agencyId_id: { agencyId, id: instanceId } },
      select: {
        template: {
          select: {
            description: true,
            manualOnly: true,
            manualOnlyReason: true,
            validityRule: true,
            validityMonths: true,
          },
        },
      },
    })
    if (row === null) {
      throw new Error(`Requirement instance ${instanceId} is missing, yet a document's evidence row points at it.`)
    }
    return row.template
  })
}

/**
 * The caregiver's own values, used only to remove themselves from what the judge is sent. No
 * audit entry: nothing read here leaves the process or reaches a person. No encrypted column.
 */
export function findJudgeRedactionTerms(agencyId: string, caregiverId: string): Promise<readonly string[]> {
  return runInAuditedTransaction(async (tx) => {
    const identity = await tx.identityRecord.findFirst({
      where: { agencyId, caregiverId },
      select: { legalFirstName: true, legalMiddleName: true, legalLastName: true, otherNames: true },
    })
    const contact = await tx.contactRecord.findFirst({
      where: { agencyId, caregiverId },
      select: { line1: true, line2: true, email: true },
    })
    return [
      identity?.legalFirstName,
      identity?.legalMiddleName,
      identity?.legalLastName,
      ...(identity?.otherNames ?? []),
      contact?.line1,
      contact?.line2,
      contact?.email,
    ].filter((term): term is string => term !== null && term !== undefined && term.trim() !== '')
  })
}

/** A clinic result's judge reasons go to the medical store and core keeps none (ADR-098). */
export function saveJudgeDecision(
  agencyId: string,
  decision: {
    readonly uploadedDocumentId: string
    readonly basis: JudgeBasis
    readonly reasons: readonly string[]
    readonly outcome: JudgeStepOutcome
  },
): Promise<void> {
  const { uploadedDocumentId, basis, reasons, outcome } = decision
  return runInAuditedTransaction(async (tx) => {
    const document = await tx.uploadedDocument.findFirst({
      where: { agencyId, id: uploadedDocumentId },
      select: { caregiverId: true, storageKey: true },
    })
    if (document === null) {
      throw new Error(`Uploaded document ${uploadedDocumentId} was deleted before its judge decision was saved.`)
    }
    const clinical = isClinical(document.storageKey)

    await tx.judgeDecision.create({
      data: {
        agencyId,
        uploadedDocumentId,
        ...(basis.kind === 'ALLOWLISTED'
          ? { matchedIssuerId: basis.issuer.id, matchedIssuerName: basis.issuer.name }
          : {
              inputHash: basis.inputHash,
              verdict: basis.verdict,
              confidence: basis.confidence,
              modelVersion: basis.modelVersion,
            }),
        reasons: clinical ? [] : [...reasons],
        staffReasons: outcome.kind === 'STAFF' ? [...outcome.reasons] : [],
      },
    })
    if (clinical && basis.kind === 'JUDGED') {
      await saveClinicalJudgeReasons(agencyId, document.caregiverId, uploadedDocumentId, reasons)
    }
  })
}

function toBasis(row: JudgeDecisionModel): JudgeBasis {
  const { matchedIssuerId, matchedIssuerName, inputHash, verdict, confidence, modelVersion } = row
  const judged = inputHash !== null || verdict !== null || confidence !== null || modelVersion !== null

  if (!judged && matchedIssuerId !== null && matchedIssuerName !== null) {
    return { kind: 'ALLOWLISTED', issuer: { id: matchedIssuerId, name: matchedIssuerName } }
  }
  if (matchedIssuerId === null && matchedIssuerName === null && inputHash !== null && verdict !== null && confidence !== null && modelVersion !== null) {
    return { kind: 'JUDGED', inputHash, verdict, confidence, modelVersion }
  }
  throw new Error(
    `The judge decision for document ${row.uploadedDocumentId} is neither exactly an allowlist hit nor exactly a judge call (ADR-097).`,
  )
}

/** Never returns reason text; readJudgeReasons is the one reader of that. */
export function findJudgeDecision(agencyId: string, uploadedDocumentId: string): Promise<JudgeDecision | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.judgeDecision.findFirst({ where: { agencyId, uploadedDocumentId } })
    if (row === null) return null
    return {
      uploadedDocumentId,
      basis: toBasis(row),
      outcome: row.staffReasons.length === 0 ? { kind: 'PASS' } : { kind: 'STAFF', reasons: row.staffReasons },
      decidedAt: row.decidedAt,
    }
  })
}

/** For a clinic result this is an audited medical read. */
export function readJudgeReasons(agencyId: string, uploadedDocumentId: string): Promise<readonly string[] | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.judgeDecision.findFirst({
      where: { agencyId, uploadedDocumentId },
      select: {
        matchedIssuerId: true,
        reasons: true,
        uploadedDocument: { select: { caregiverId: true, storageKey: true } },
      },
    })
    if (row === null) return null
    if (row.matchedIssuerId !== null) return []
    if (isClinical(row.uploadedDocument.storageKey)) {
      return readClinicalJudgeReasons(agencyId, row.uploadedDocument.caregiverId, uploadedDocumentId)
    }
    return row.reasons
  })
}
