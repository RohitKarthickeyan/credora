import 'server-only'
import { findInviteLanding } from '@/db/repositories/invites'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import type { LinkUseCase } from '@/server/auth/link-token'
import { defineLinkUseCase } from '@/server/auth/link-token'

export const viewInvite: LinkUseCase<
  Record<string, never>,
  { readonly agencyName: string; readonly caregiverId: string }
> = defineLinkUseCase('INVITE', 'inspect', async ({ grant, tx }) => {
  const landing = await findInviteLanding(tx, grant.agencyId, grant.caregiverId)
  if (landing === null) {
    throw new Error(`Invite token ${grant.tokenId} names a caregiver that does not exist.`)
  }
  return { agencyName: landing.agencyName, caregiverId: grant.caregiverId }
})

/**
 * Start the invited caregiver's paperwork. NOT_YOURS is a backstop — the page offers the button
 * only to the matching session — and the token is consumed in that case too, because run returns
 * normally. A refused transition (already started, or further along) is not an error here.
 */
export const acceptInvite: LinkUseCase<{ readonly caregiverId: string }, 'STARTED' | 'NOT_YOURS'> =
  defineLinkUseCase('INVITE', 'consume', async ({ grant, input, tx }) => {
    if (grant.caregiverId !== input.caregiverId) return 'NOT_YOURS'

    await applyPipelineTransition(tx, grant.agencyId, {
      caregiverId: grant.caregiverId,
      event: 'INTAKE_STARTED',
      actorUserId: null,
    })
    return 'STARTED'
  })
