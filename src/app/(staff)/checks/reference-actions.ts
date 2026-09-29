'use server'

import { revalidatePath } from 'next/cache'
import type { ReferenceCheckDecisionRefusal, ReferenceRequestRefusal } from '@/domain/requirements/reference-check'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { decideReferenceCheck, recordReferenceByPhone, requestReference } from '@/server/verification/references'

type ReferenceActionState = { readonly error?: string }

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

const REQUEST_REFUSALS: Record<ReferenceRequestRefusal, string> = {
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
  ALREADY_REQUESTED: 'A request has already been sent to this reference.',
  NOT_OUTSTANDING: "This caregiver's reference check is not waiting for answers.",
  DO_NOT_CONTACT: 'The caregiver asked us not to contact this employer.',
  NO_CONTACT_DETAILS: 'This reference has no phone number or email address.',
}

export async function requestReferenceAction(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const { principal } = await requireStaffSession()
  const values = { referenceId: text(formData, 'referenceId') }

  const result = await runAsPrincipal(principal, {}, () => requestReference(values))
  if (!result.ok) return { error: REQUEST_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}

const RECORD_REFUSALS = {
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
  NOT_ESCALATED: 'This reference is not waiting for a call.',
} as const

export async function recordReferenceResponseAction(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const { principal } = await requireStaffSession()
  const values = {
    referenceId: text(formData, 'referenceId'),
    workedWith: text(formData, 'workedWith'),
    wouldRecommend: text(formData, 'wouldRecommend'),
    comments: text(formData, 'comments'),
  }

  const result = await runAsPrincipal(principal, {}, () => recordReferenceByPhone(values))
  if (!result.ok) return { error: RECORD_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}

const DECISION_REFUSALS: Record<ReferenceCheckDecisionRefusal, string> = {
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
  NOT_AWAITING_REVIEW: 'This reference check is not waiting for a review decision.',
}

export async function decideReferenceCheckAction(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const { principal } = await requireStaffSession()
  const values = { caregiverId: text(formData, 'caregiverId'), decision: text(formData, 'decision') }

  const result = await runAsPrincipal(principal, {}, () => decideReferenceCheck(values))
  if (!result.ok) return { error: DECISION_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}
