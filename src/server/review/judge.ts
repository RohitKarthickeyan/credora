import 'server-only'
import { createHash } from 'node:crypto'
import { format } from 'date-fns'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findLiveAcceptedIssuers } from '@/db/repositories/accepted-issuers'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { findDocumentExtraction, readExtractionText } from '@/db/repositories/extractions'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import {
  findJudgeDecision,
  findJudgeRedactionTerms,
  findJudgeRequirement,
  saveJudgeDecision,
} from '@/db/repositories/judge-decisions'
import { matchAcceptedIssuer } from '@/domain/documents/accepted-issuer'
import type { NormalisedFields } from '@/domain/documents/extraction'
import { type JudgeInputText, redactForJudge } from '@/domain/documents/judge-redaction'
import { type JudgeBasis, allowlistIssuerText, judgeStepOutcome } from '@/domain/documents/judge-review'
import type { JudgeInput } from '@/integrations/ports/judge'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { AUTO_ACCEPT_DOCUMENT_JOB_TYPE } from './auto-accept-job'

export const JUDGE_DOCUMENT_JOB_TYPE = 'review.judgeDocument'

// A fixed field order, so the same redacted input always gives the same hash.
function hash(input: JudgeInputText): string {
  return createHash('sha256')
    .update(JSON.stringify([input.requirementDescription, input.issuerName, input.documentText]))
    .digest('hex')
}

function extractionTerms(fields: NormalisedFields): string[] {
  const name = fields.fullName?.value
  return [
    ...[name?.first, name?.middle, name?.last].flatMap((part) => part?.split(/\s+/) ?? []),
    ...[fields.fullName, fields.dateOfBirth, fields.address, fields.documentNumber].flatMap((field) =>
      field === undefined ? [] : [field.asPrinted],
    ),
  ]
}

/**
 * Reviews one extracted document once. An allowlist hit means the judge is never called
 * (AGENTIC-TASKS.md § Permitted 1); otherwise only redacted text is sent, outside any
 * transaction, and a VendorUnavailableError escapes so the queue retries. A WITHDRAWN caregiver
 * ends the job before anything is read or sent (ADR-079). The outcome is one input to T-074; this
 * job never accepts a requirement or moves a caregiver.
 */
export const judgeDocumentJob = defineJobHandler({
  type: JUDGE_DOCUMENT_JOB_TYPE,
  schema: z.object({ uploadedDocumentId: z.uuid() }),
  run: ({ uploadedDocumentId }, { agencyId, now }) =>
    runAsSystem(async () => {
      if ((await findJudgeDecision(agencyId, uploadedDocumentId)) !== null) return { status: 'ok' }
      const extraction = await findDocumentExtraction(agencyId, uploadedDocumentId)
      if (extraction === null) return { status: 'ok' }
      const { caregiverId, fields } = extraction
      const caregiver = await findCaregiverForSession(agencyId, caregiverId)
      if (caregiver === null || caregiver.stage === 'WITHDRAWN') return { status: 'ok' }

      const requirement = await findJudgeRequirement(agencyId, extraction.instanceId)

      const issuerText = allowlistIssuerText(fields)
      const issuer =
        issuerText === null ? null : matchAcceptedIssuer(issuerText, await findLiveAcceptedIssuers(agencyId))

      let basis: JudgeBasis
      let reasons: readonly string[]
      if (issuer !== null) {
        basis = { kind: 'ALLOWLISTED', issuer: { id: issuer.id, name: issuer.name } }
        reasons = []
      } else {
        const documentText = await readExtractionText(agencyId, uploadedDocumentId)
        if (documentText === null) return { status: 'ok' }
        const input: JudgeInput = redactForJudge(
          { requirementDescription: requirement.description, issuerName: fields.issuer?.value ?? null, documentText },
          [...extractionTerms(fields), ...(await findJudgeRedactionTerms(agencyId, caregiverId))],
        )
        const result = await getPort('judge').assess(input)
        basis = {
          kind: 'JUDGED',
          inputHash: hash(input),
          verdict: result.verdict,
          confidence: result.confidence,
          modelVersion: result.modelVersion,
        }
        reasons = result.reasons
      }

      // OPEN-QUESTIONS 158: the worker process's local calendar date.
      const outcome = judgeStepOutcome({ requirement, fields, today: format(now, 'yyyy-MM-dd'), basis })

      await runInAuditedTransaction(async (tx) => {
        await saveJudgeDecision(agencyId, { uploadedDocumentId, basis, reasons, outcome })
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'CAREGIVER',
          entityId: caregiverId,
          fieldName: 'judgeDecisions',
        })
        await enqueueJobInTransaction(tx, {
          agencyId,
          type: AUTO_ACCEPT_DOCUMENT_JOB_TYPE,
          payload: { uploadedDocumentId },
          idempotencyKey: buildIdempotencyKey(AUTO_ACCEPT_DOCUMENT_JOB_TYPE, [uploadedDocumentId]),
        })
      })
      return { status: 'ok' }
    }),
})
