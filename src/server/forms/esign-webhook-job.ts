import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { applyDocumentReviewCleared } from '@/db/repositories/document-review'
import { findDocumentSet } from '@/db/repositories/document-set'
import { closeEnvelope, findEnvelopeByVendorId } from '@/db/repositories/envelopes'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import { createSignedDocument } from '@/db/repositories/signed-documents'
import { defineJobHandler } from '@/integrations/queue/handler'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { enqueueNudge } from '@/server/conversation/nudge-job'
import { WEBHOOK_JOB_TYPES, esignWebhookJobPayloadSchema } from '@/server/webhooks/jobs'

function assertMoved(change: InstanceStatusChange, instanceId: string): void {
  if (!change.ok && change.refusal !== 'ALREADY_IN_STATUS') {
    throw new Error(
      `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
        `(${change.refusal}) while its signed copy was recorded.`,
    )
  }
}

// The status table has no NOT_STARTED/EXPIRED → SATISFIED edge, so those go through PENDING.
async function satisfy(agencyId: string, instanceId: string): Promise<void> {
  const change = await changeRequirementInstanceStatus(agencyId, instanceId, 'SATISFIED')
  if (!change.ok && (change.from === 'NOT_STARTED' || change.from === 'EXPIRED')) {
    assertMoved(await changeRequirementInstanceStatus(agencyId, instanceId, 'PENDING'), instanceId)
    assertMoved(await changeRequirementInstanceStatus(agencyId, instanceId, 'SATISFIED'), instanceId)
    return
  }
  assertMoved(change, instanceId)
}

/**
 * The event is a notification only: the provider's envelope is re-read and the event body never
 * is, because the mock's signing secret is public (T-052). Signed copies satisfy their
 * instances without review, and every refusal of ENVELOPE_COMPLETED is accepted, so a caregiver
 * withdrawn while signing keeps their legally signed copies (ADR-078). Claiming SENT → SIGNED
 * first is what makes a redelivery write nothing.
 */
export const esignWebhookJob = defineJobHandler({
  type: WEBHOOK_JOB_TYPES.esign,
  schema: esignWebhookJobPayloadSchema,
  run: ({ envelopeId: vendorEnvelopeId }, { agencyId }) =>
    runAsSystem(async () => {
      const vendor = await getPort('esign').getEnvelope(agencyId, vendorEnvelopeId)
      if (vendor === null) {
        return { status: 'fail', reason: `The provider has no envelope ${vendorEnvelopeId}.` }
      }

      switch (vendor.status) {
        case 'created':
        case 'sent':
          return { status: 'ok' }
        case 'declined':
        case 'voided': {
          const status = vendor.status === 'declined' ? 'DECLINED' : 'VOIDED'
          await runInAuditedTransaction((tx) =>
            closeEnvelope(tx, agencyId, vendorEnvelopeId, { status }),
          )
          return { status: 'ok' }
        }
        case 'signed':
          break
      }

      const envelope = await runInAuditedTransaction((tx) =>
        findEnvelopeByVendorId(tx, agencyId, vendorEnvelopeId),
      )
      if (envelope === null) {
        throw new Error(
          `Envelope ${vendorEnvelopeId} has a WebhookSubject but no Envelope row; the two are ` +
            'registered in one transaction.',
        )
      }

      // Dead-letter for a human rather than store a partial set.
      const inconsistent = {
        status: 'fail',
        reason: `The provider reports envelope ${vendorEnvelopeId} signed but its documents do not match ours.`,
      } as const
      if (vendor.signedAt === null || vendor.documents.length !== envelope.documents.length) {
        return inconsistent
      }
      const copies: { documentKey: string; templateVersion: string; signedPdfKey: string }[] = []
      for (const document of envelope.documents) {
        const signedPdfKey = vendor.documents.find(
          ({ documentRef }) => documentRef === document.documentKey,
        )?.signedPdfKey
        if (signedPdfKey === undefined || signedPdfKey === null) return inconsistent
        copies.push({ ...document, signedPdfKey })
      }
      const signedAt = new Date(vendor.signedAt)
      const { caregiverId } = envelope
      const set = await findDocumentSet(agencyId, caregiverId)

      await runInAuditedTransaction(async (tx) => {
        if (!(await closeEnvelope(tx, agencyId, vendorEnvelopeId, { status: 'SIGNED', signedAt }))) {
          return
        }

        const signedDocumentIds = new Map<string, string>()
        for (const copy of copies) {
          const { id } = await createSignedDocument(tx, agencyId, caregiverId, {
            templateKey: copy.documentKey,
            templateVersion: copy.templateVersion,
            envelopeId: vendorEnvelopeId,
            signedPdfKey: copy.signedPdfKey,
            signedAt,
          })
          signedDocumentIds.set(copy.documentKey, id)
        }

        for (const entry of set) {
          const signedDocumentId = signedDocumentIds.get(entry.documentKey)
          if (signedDocumentId === undefined) continue
          for (const { instanceId } of entry.satisfies) {
            const link = await linkEvidence(agencyId, instanceId, entry.documentKey, {
              kind: 'SIGNED_DOCUMENT',
              signedDocumentId,
            })
            if (!link.ok) {
              throw new Error(
                `Requirement instance ${instanceId} does not accept ${entry.documentKey}, though ` +
                  'the document set was selected from its own template.',
              )
            }
            await satisfy(agencyId, instanceId)
          }
        }

        await applyPipelineTransition(tx, agencyId, {
          caregiverId,
          event: 'ENVELOPE_COMPLETED',
          actorUserId: null,
        })
        await applyDocumentReviewCleared(tx, agencyId, caregiverId, null)
        await enqueueNudge(tx, agencyId, caregiverId, 'SIGNED', `envelope-signed:${envelope.id}`)
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'CAREGIVER',
          entityId: caregiverId,
          fieldName: 'signedDocuments',
        })
      })
      return { status: 'ok' }
    }),
})
