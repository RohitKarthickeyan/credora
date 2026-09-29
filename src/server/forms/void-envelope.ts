import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { closeEnvelope, findSentEnvelope } from '@/db/repositories/envelopes'
import { getPort } from '@/integrations/registry'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type VoidEnvelopeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NOT_VOIDABLE' | 'CHANGED_AT_PROVIDER' }

// Fixed, never staff free text: the vendor may show the reason to the signer (ADR-096).
const VOID_REASON = 'Voided by the agency. A new set will be prepared.'

// A void changes no stage and no requirement instance: a voided envelope stored nothing, and the
// caregiver prepares a fresh set from /sign (ADR-078). Nobody is notified (OPEN-QUESTIONS 153).
export const voidEnvelope: UseCase<{ readonly caregiverId: string }, VoidEnvelopeResult> =
  defineUseCase('envelope.void', async ({ principal, input }) => {
    const { agencyId } = principal
    const sent = await runInAuditedTransaction((tx) =>
      findSentEnvelope(tx, agencyId, input.caregiverId),
    )
    if (sent === null) return { ok: false, reason: 'NOT_VOIDABLE' }

    const esign = getPort('esign')
    const atProvider = await esign.getEnvelope(agencyId, sent.vendorEnvelopeId)
    if (atProvider === null) {
      throw new Error('A SENT envelope is unknown to the e-signature provider.')
    }
    if (atProvider.status === 'signed' || atProvider.status === 'declined') {
      return { ok: false, reason: 'CHANGED_AT_PROVIDER' }
    }

    await esign.voidEnvelope(agencyId, sent.vendorEnvelopeId, VOID_REASON)

    // Audited even when closeEnvelope finds nothing: a voided webhook may have closed the row
    // first, and the staff void still happened.
    await runInAuditedTransaction(async (tx) => {
      await closeEnvelope(tx, agencyId, sent.vendorEnvelopeId, { status: 'VOIDED' })
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: input.caregiverId,
      })
    })
    return { ok: true }
  })
