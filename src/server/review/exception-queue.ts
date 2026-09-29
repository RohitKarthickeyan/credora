import 'server-only'
import { z } from 'zod'
import { findAutoAcceptDecision } from '@/db/repositories/auto-accept-decisions'
import { findFlaggedDocumentRows, findOpenEnvelopes, findStalledReviewDocuments } from '@/db/repositories/exception-queue'
import { findDocumentExtraction } from '@/db/repositories/extractions'
import { listJobs, requeueJob } from '@/db/repositories/jobs'
import { findJudgeDecision, readJudgeReasons } from '@/db/repositories/judge-decisions'
import { unconfidentReadings } from '@/domain/documents/auto-accept'
import {
  type ExceptionQueue,
  type FlaggedDocument,
  type JudgeReasoning,
  type ReviewStep,
  type SigningStep,
  type StalledReview,
  type StalledSigning,
  selectFlaggedDocuments,
} from '@/domain/documents/exception-queue'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { EXTRACT_DOCUMENT_JOB_TYPE } from '@/server/documents/extraction-job'
import { SEND_ENVELOPE_JOB_TYPE } from '@/server/forms/send-envelope-job'
import { WEBHOOK_JOB_TYPES, esignWebhookJobPayloadSchema } from '@/server/webhooks/jobs'
import { AUTO_ACCEPT_DOCUMENT_JOB_TYPE } from './auto-accept-job'
import { CAREGIVER_NOTICE_JOB_TYPE } from './caregiver-notice-job'
import { JUDGE_DOCUMENT_JOB_TYPE } from './judge'

const REVIEW_JOB_STEPS: ReadonlyMap<string, ReviewStep> = new Map([
  [EXTRACT_DOCUMENT_JOB_TYPE, 'EXTRACTION'],
  [JUDGE_DOCUMENT_JOB_TYPE, 'JUDGE'],
  [AUTO_ACCEPT_DOCUMENT_JOB_TYPE, 'AUTO_ACCEPT'],
])

// Each handler is idempotent on re-run, so a retry cannot double-apply (ADR-112).
const RETRYABLE_JOB_TYPES: ReadonlySet<string> = new Set([
  ...REVIEW_JOB_STEPS.keys(),
  SEND_ENVELOPE_JOB_TYPE,
  WEBHOOK_JOB_TYPES.esign,
  CAREGIVER_NOTICE_JOB_TYPE,
])

const reviewPayloadSchema = z.object({ uploadedDocumentId: z.uuid() })
const sendEnvelopePayloadSchema = z.object({ envelopeId: z.uuid() })
const noticePayloadSchema = z.object({ staffDecisionId: z.uuid() })

type DeadJob = Awaited<ReturnType<typeof listJobs>>[number]

async function flaggedDocuments(agencyId: string, dead: readonly DeadJob[]): Promise<FlaggedDocument[]> {
  const stoppedNotices = new Map(
    dead.flatMap((job) => {
      const payload = noticePayloadSchema.safeParse(job.payload)
      return job.type === CAREGIVER_NOTICE_JOB_TYPE && payload.success ? [[payload.data.staffDecisionId, job.id] as const] : []
    }),
  )
  const flagged: FlaggedDocument[] = []
  // Sequential: each finder opens its own transaction, and concurrent ones would exhaust the pool.
  for (const { clinical, returned, ...row } of selectFlaggedDocuments(await findFlaggedDocumentRows(agencyId))) {
    const autoAccept = await findAutoAcceptDecision(agencyId, row.uploadedDocumentId)
    const extraction = await findDocumentExtraction(agencyId, row.uploadedDocumentId)
    if (autoAccept === null || extraction === null) continue
    const judge = await findJudgeDecision(agencyId, row.uploadedDocumentId)

    // The clinical test comes before any reasons read: for a clinic result that read is an audited
    // medical read, and a coordinator is not permitted medical detail (SECURITY.md).
    let judgeReasoning: JudgeReasoning
    if (judge === null || judge.basis.kind === 'ALLOWLISTED') judgeReasoning = { kind: 'SHOWN', reasons: [] }
    else if (clinical) judgeReasoning = { kind: 'CLINICAL' }
    else judgeReasoning = { kind: 'SHOWN', reasons: (await readJudgeReasons(agencyId, row.uploadedDocumentId)) ?? [] }

    flagged.push({
      ...row,
      autoAccept,
      unconfidentReadings: unconfidentReadings(extraction),
      judge,
      judgeReasoning,
      returned:
        returned === null
          ? null
          : {
              ...returned,
              stoppedNoticeJobId:
                returned.notice === 'QUEUED' ? (stoppedNotices.get(returned.staffDecisionId) ?? null) : null,
            },
    })
  }
  return flagged
}

async function stalledReviews(agencyId: string, dead: readonly DeadJob[]): Promise<StalledReview[]> {
  const jobs = dead.flatMap((job) => {
    const step = REVIEW_JOB_STEPS.get(job.type)
    const payload = reviewPayloadSchema.safeParse(job.payload)
    return step === undefined || !payload.success ? [] : [{ job, step, uploadedDocumentId: payload.data.uploadedDocumentId }]
  })
  const documents = await findStalledReviewDocuments(
    agencyId,
    jobs.map((kept) => kept.uploadedDocumentId),
  )
  const byId = new Map(documents.map((document) => [document.uploadedDocumentId, document]))

  return jobs.flatMap(({ job, step, uploadedDocumentId }) => {
    const document = byId.get(uploadedDocumentId)
    return document === undefined
      ? []
      : [{ ...document, jobId: job.id, step, attempts: job.attempts, stoppedAt: job.finishedAt }]
  })
}

// A dead send is matched on our Envelope.id, a dead webhook on the vendor's envelope id.
async function stalledSignings(agencyId: string, dead: readonly DeadJob[]): Promise<StalledSigning[]> {
  const jobs = dead.flatMap((job): { job: DeadJob; step: SigningStep; id: string }[] => {
    if (job.type === SEND_ENVELOPE_JOB_TYPE) {
      const payload = sendEnvelopePayloadSchema.safeParse(job.payload)
      return payload.success ? [{ job, step: 'SEND', id: payload.data.envelopeId }] : []
    }
    if (job.type === WEBHOOK_JOB_TYPES.esign) {
      const payload = esignWebhookJobPayloadSchema.safeParse(job.payload)
      return payload.success ? [{ job, step: 'RECORD', id: payload.data.envelopeId }] : []
    }
    return []
  })
  const envelopes = await findOpenEnvelopes(agencyId, {
    envelopeIds: jobs.filter(({ step }) => step === 'SEND').map(({ id }) => id),
    vendorEnvelopeIds: jobs.filter(({ step }) => step === 'RECORD').map(({ id }) => id),
  })

  return jobs.flatMap(({ job, step, id }) => {
    const envelope = envelopes.find((open) => (step === 'SEND' ? open.envelopeId : open.vendorEnvelopeId) === id)
    return envelope === undefined
      ? []
      : [
          {
            jobId: job.id,
            step,
            caregiverId: envelope.caregiverId,
            caregiverName: envelope.caregiverName,
            attempts: job.attempts,
            stoppedAt: job.finishedAt,
          },
        ]
  })
}

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry (ADR-105).
export const getExceptionQueue: UseCase<Record<string, never>, ExceptionQueue> = defineUseCase(
  'exceptionQueue.view',
  async ({ principal }) => {
    const dead = await listJobs(principal.agencyId, { state: 'DEAD' })
    return {
      flagged: await flaggedDocuments(principal.agencyId, dead),
      stalled: await stalledReviews(principal.agencyId, dead),
      stalledSigning: await stalledSignings(principal.agencyId, dead),
    }
  },
)

type RetryStoppedJobResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'NOT_STOPPED' }

// No audit entry: a retry reads and writes no caregiver field, and the job keeps its own attempt
// log (ADR-112).
export const retryStoppedJob: UseCase<{ readonly jobId: string }, RetryStoppedJobResult> = defineUseCase(
  'exceptionQueue.decide',
  async ({ principal, input: raw }) => {
    const { jobId } = z.object({ jobId: z.uuid() }).parse(raw)
    const dead = await listJobs(principal.agencyId, { state: 'DEAD' })
    if (!dead.some((job) => job.id === jobId && RETRYABLE_JOB_TYPES.has(job.type))) {
      return { ok: false, reason: 'NOT_STOPPED' }
    }
    return (await requeueJob(principal.agencyId, jobId, new Date())) === null
      ? { ok: false, reason: 'NOT_STOPPED' }
      : { ok: true }
  },
)
