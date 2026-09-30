import 'server-only'
import type { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createInvitedCaregiver, isEmailInUse, isMobilePhoneInUse } from '@/db/repositories/invites'
import { enqueueJobInTransaction } from '@/db/repositories/jobs'
import { materialiseRequirementInstances } from '@/db/repositories/requirement-instances'
import { inviteCaregiverInputSchema } from '@/domain/pipeline/invite'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { INVITE_EMAIL_JOB_TYPE } from './invite-email-job'

type InviteCaregiverResult =
  | { readonly ok: true; readonly caregiverId: string; readonly inviteId: string }
  | { readonly ok: false; readonly reason: 'EMAIL_IN_USE' }
  | { readonly ok: false; readonly reason: 'PHONE_IN_USE' }
  | { readonly ok: false; readonly reason: 'REQUIREMENTS_AMBIGUOUS'; readonly keys: readonly string[] }

// Thrown to roll the caregiver, invite and audit rows back with the ambiguity: a caregiver with
// no requirement list would read "None outstanding" on the board, the unsafe direction.
class RequirementsAmbiguous extends Error {
  constructor(readonly keys: readonly string[]) {
    super(`Ambiguous requirement templates: ${keys.join(', ')}.`)
  }
}

/**
 * Record an accepted offer: the caregiver at INVITED with its resolution context and sign-in email,
 * its requirement list, and a queued invite email — all or none, in one transaction.
 * The input is the form's and is parsed here: the type parameter is not a runtime check.
 */
export const inviteCaregiver: UseCase<
  Readonly<Record<keyof z.input<typeof inviteCaregiverInputSchema>, string>>,
  InviteCaregiverResult
> = defineUseCase('caregiver.invite', async ({ principal, input: raw }) => {
  const { agencyId } = principal
  const input = inviteCaregiverInputSchema.parse(raw)

  try {
    return await runInAuditedTransaction(async (tx): Promise<InviteCaregiverResult> => {
      if (input.email !== undefined && (await isEmailInUse(tx, agencyId, input.email))) {
        return { ok: false, reason: 'EMAIL_IN_USE' }
      }
      if (await isMobilePhoneInUse(tx, agencyId, input.mobilePhone)) {
        return { ok: false, reason: 'PHONE_IN_USE' }
      }

      const { caregiverId, inviteId } = await createInvitedCaregiver(tx, agencyId, input)
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
      })

      const materialised = await materialiseRequirementInstances(agencyId, caregiverId, {
        state: input.workState,
        serviceType: input.serviceType,
        payer: input.payer,
      })
      if (!materialised.ok) {
        throw new RequirementsAmbiguous(materialised.ambiguities.map(({ key }) => key))
      }

      await enqueueJobInTransaction(tx, {
        agencyId,
        type: INVITE_EMAIL_JOB_TYPE,
        payload: { inviteId },
        idempotencyKey: buildIdempotencyKey(INVITE_EMAIL_JOB_TYPE, [inviteId]),
      })
      return { ok: true, caregiverId, inviteId }
    })
  } catch (error) {
    if (error instanceof RequirementsAmbiguous) {
      return { ok: false, reason: 'REQUIREMENTS_AMBIGUOUS', keys: error.keys }
    }
    throw error
  }
})
