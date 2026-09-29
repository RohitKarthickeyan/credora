import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findDocumentSet } from '@/db/repositories/document-set'
import { findSendContext, recordPreparedEnvelope } from '@/db/repositories/envelopes'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import {
  changeRequirementInstanceStatus,
  findResolutionContext,
  materialiseRequirementInstances,
} from '@/db/repositories/requirement-instances'
import { findSignedDocuments } from '@/db/repositories/signed-documents'
import {
  type EnvelopeStatus,
  type GenerationRefusal,
  SEND_STAGES,
  type SendProblem,
  issuedOnFor,
  partitionDocumentSet,
  sendProblemsFrom,
  signingStateFor,
} from '@/domain/documents/envelope'
import type { StoragePort } from '@/integrations/ports/storage'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { type GeneratedDocument, generateAgencyDocuments } from './agency-documents'
import { generateOfficialForms } from './official-forms'
import { SEND_ENVELOPE_JOB_TYPE } from './send-envelope-job'

export type SendDocumentSetResult =
  | { readonly ok: true; readonly state: 'preparing' | 'sent' | 'signed' }
  | { readonly ok: false; readonly reason: 'not-ready' }
  | { readonly ok: false; readonly reason: 'requirements-ambiguous'; readonly keys: readonly string[] }
  | { readonly ok: false; readonly reason: 'nothing-to-sign' }
  | { readonly ok: false; readonly reason: 'no-generator'; readonly documentKeys: readonly string[] }
  | { readonly ok: false; readonly reason: 'no-signer' }
  | { readonly ok: false; readonly reason: 'cannot-generate'; readonly problems: readonly SendProblem[] }

const NOT_READY = { ok: false, reason: 'not-ready' } as const

const OPEN_STATE: Readonly<Record<EnvelopeStatus, 'preparing' | 'sent' | 'signed' | null>> = {
  PREPARING: 'preparing',
  SENT: 'sent',
  SIGNED: 'signed',
  DECLINED: null,
  VOIDED: null,
}

// Thrown to roll the envelope back when the caregiver left the send stages mid-send (withdrawn).
class NotReady extends Error {}

function cannotGenerate(refusals: readonly GenerationRefusal[]): SendDocumentSetResult {
  return { ok: false, reason: 'cannot-generate', problems: sendProblemsFrom(refusals) }
}

/**
 * Generates the caregiver's whole document set and records it as one PREPARING envelope; the
 * vendor call is esign.sendEnvelope's (ADR-077). Pressing again while an envelope is open
 * returns its state and writes nothing. Unsigned official PDFs print SSNs in the clear, so every
 * PDF written is deleted again if the send is refused after writing it.
 */
export const sendOwnDocumentSet: UseCase<
  { readonly caregiverId: string; readonly storage: StoragePort },
  SendDocumentSetResult
> = defineUseCase('caregiver.editOwn', async ({ principal, input }) => {
  const { agencyId } = principal
  const { caregiverId, storage } = input

  const context = await findSendContext(agencyId, caregiverId)
  if (context === null) return NOT_READY
  const open = context.latestEnvelope === null ? null : OPEN_STATE[context.latestEnvelope.status]
  if (open !== null) return { ok: true, state: open }
  if (!SEND_STAGES.includes(context.stage) || context.workState === null || context.serviceType === null) {
    return NOT_READY
  }
  if (context.signer === null) return { ok: false, reason: 'no-signer' }

  const resolutionContext = await findResolutionContext(agencyId, caregiverId)
  if (resolutionContext === null) return NOT_READY
  const materialised = await materialiseRequirementInstances(agencyId, caregiverId, resolutionContext)
  if (!materialised.ok) {
    return {
      ok: false,
      reason: 'requirements-ambiguous',
      keys: materialised.ambiguities.map(({ key }) => key),
    }
  }

  const set = await findDocumentSet(agencyId, caregiverId)
  if (set.length === 0) return { ok: false, reason: 'nothing-to-sign' }
  const { official, agency, ungenerated } = partitionDocumentSet(set)
  if (ungenerated.length > 0) return { ok: false, reason: 'no-generator', documentKeys: ungenerated }

  const documents: GeneratedDocument[] = []
  const discard = async () => {
    for (const document of documents) await storage.delete(agencyId, document.unsignedPdfKey)
  }

  // Agency documents first: an official-form refusal then orphans nothing that printed a sealed value.
  if (agency.length > 0) {
    const generated = await generateAgencyDocuments(
      agencyId,
      caregiverId,
      agency,
      issuedOnFor(new Date()),
      storage,
    )
    if (!generated.ok) {
      return generated.reason === 'unknown-caregiver' ? NOT_READY : cannotGenerate(generated.refusals)
    }
    documents.push(...generated.documents)
  }
  if (official.length > 0) {
    const generated = await generateOfficialForms(agencyId, caregiverId, official, storage)
    if (!generated.ok) {
      await discard()
      return generated.reason === 'unknown-caregiver' ? NOT_READY : cannotGenerate(generated.refusals)
    }
    documents.push(...generated.documents)
  }

  const instanceIds = new Set(set.flatMap((entry) => entry.satisfies.map(({ instanceId }) => instanceId)))
  try {
    await runInAuditedTransaction(async (tx) => {
      const { envelopeId } = await recordPreparedEnvelope(tx, agencyId, { caregiverId, documents })

      for (const instanceId of instanceIds) {
        const change = await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING')
        if (!change.ok && change.refusal !== 'ALREADY_IN_STATUS') {
          throw new Error(
            `Requirement instance ${instanceId} moved to ${change.from} mid-send; a concurrent ` +
              'writer changed it.',
          )
        }
      }

      const moved = await applyPipelineTransition(tx, agencyId, {
        caregiverId,
        event: 'INTAKE_SUBMITTED',
        actorUserId: null,
      })
      if (!moved.ok && moved.refusal !== 'ALREADY_APPLIED') throw new NotReady()

      await writeAuditEntry(tx, {
        agencyId,
        action: 'EXPORT',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
      })
      await enqueueJobInTransaction(tx, {
        agencyId,
        type: SEND_ENVELOPE_JOB_TYPE,
        payload: { envelopeId },
        idempotencyKey: buildIdempotencyKey(SEND_ENVELOPE_JOB_TYPE, [envelopeId]),
      })
    })
  } catch (error) {
    if (error instanceof NotReady) {
      await discard()
      return NOT_READY
    }
    throw error
  }

  return { ok: true, state: 'preparing' }
})

export type SigningView =
  | { readonly state: 'not-ready' }
  | { readonly state: 'ready'; readonly previous: 'DECLINED' | 'VOIDED' | null }
  | { readonly state: 'preparing'; readonly documentNames: readonly string[] }
  | { readonly state: 'sent'; readonly signingUrl: string | null; readonly documentNames: readonly string[] }
  | {
      readonly state: 'signed'
      readonly documents: readonly { readonly name: string; readonly signedAt: Date }[]
    }

export const viewOwnSigning: UseCase<{ readonly caregiverId: string }, SigningView> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) => {
    const { agencyId } = principal
    const { caregiverId } = input

    const context = await runInAuditedTransaction(async (tx) => {
      await writeAuditEntry(tx, {
        agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
      })
      return findSendContext(agencyId, caregiverId)
    })
    if (context === null) return { state: 'not-ready' }

    const latest = context.latestEnvelope
    const state = signingStateFor(context.stage, latest)
    if (state === 'not-ready') return { state }
    if (state === 'ready' || latest === null) {
      const previous = latest?.status === 'DECLINED' || latest?.status === 'VOIDED' ? latest.status : null
      return { state: 'ready', previous }
    }

    const documentNames = latest.documents.map(({ name }) => name)
    if (state === 'preparing') return { state, documentNames }
    if (state === 'sent') return { state, signingUrl: latest.signingUrl, documentNames }

    const signed = await findSignedDocuments(agencyId, caregiverId)
    return {
      state,
      documents: latest.documents.flatMap(({ documentKey, name }) => {
        const copy = signed.find(({ templateKey }) => templateKey === documentKey)
        return copy === undefined ? [] : [{ name, signedAt: copy.signedAt }]
      }),
    }
  },
)
