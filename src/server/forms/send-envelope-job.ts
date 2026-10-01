import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { findEnvelopeForSend, recordEnvelopeSent } from '@/db/repositories/envelopes'
import { registerWebhookSubject } from '@/db/repositories/inbound-webhooks'
import { defineJobHandler } from '@/integrations/queue/handler'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { enqueueNudge } from '@/server/conversation/nudge-job'

export const SEND_ENVELOPE_JOB_TYPE = 'esign.sendEnvelope'

/**
 * Creates the vendor envelope for a PREPARING Envelope (ADR-077). The vendor call is outside any
 * transaction; a VendorUnavailableError escapes so the queue retries, and the same idempotency key
 * makes the retry return the same vendor envelope. The vendor id is recorded in the transaction
 * that registers its WebhookSubject, or every callback would be answered 409 (ADR-044). A
 * WITHDRAWN caregiver ends the job with no vendor call (ADR-079).
 */
export const sendEnvelopeJob = defineJobHandler({
  type: SEND_ENVELOPE_JOB_TYPE,
  schema: z.object({ envelopeId: z.uuid() }),
  run: ({ envelopeId }, { agencyId }) =>
    runAsSystem(async () => {
      const envelope = await runInAuditedTransaction((tx) =>
        findEnvelopeForSend(tx, agencyId, envelopeId),
      )
      if (envelope === null || envelope.status !== 'PREPARING') return { status: 'ok' }
      const caregiver = await findCaregiverForSession(agencyId, envelope.caregiverId)
      if (caregiver === null || caregiver.stage === 'WITHDRAWN') return { status: 'ok' }
      if (envelope.signer === null) {
        return {
          status: 'fail',
          reason: "The caregiver's legal name or email was removed after the send.",
        }
      }

      // OPEN-QUESTIONS 121: the caregiver is the only signer; no agency countersignature is requested.
      const vendor = await getPort('esign').createEnvelope({
        agencyId,
        caregiverId: envelope.caregiverId,
        documents: envelope.documents.map(({ documentKey, name, unsignedPdfKey }) => ({
          documentRef: documentKey,
          name,
          unsignedPdfKey,
        })),
        signers: [{ role: 'caregiver', ...envelope.signer }],
        idempotencyKey: buildIdempotencyKey('esign.createEnvelope', [envelopeId]),
      })

      await runInAuditedTransaction(async (tx) => {
        const recorded = await recordEnvelopeSent(tx, agencyId, envelopeId, {
          vendorEnvelopeId: vendor.envelopeId,
          signingUrl: vendor.signingUrl,
        })
        if (recorded) {
          await registerWebhookSubject(tx, agencyId, {
            provider: 'esign',
            externalId: vendor.envelopeId,
          })
          await enqueueNudge(tx, agencyId, envelope.caregiverId, null, `envelope-sent:${envelopeId}`)
        }
      })
      return { status: 'ok' }
    }),
})
