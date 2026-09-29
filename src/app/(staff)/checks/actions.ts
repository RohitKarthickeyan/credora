'use server'

import { revalidatePath } from 'next/cache'
import type {
  BackgroundCheckAdjudicationRefusal,
  BackgroundCheckOrderRefusal,
} from '@/domain/requirements/background-check'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { recordManualCheck } from '@/server/review/manual-checks'
import { adjudicateBackgroundCheck, orderBackgroundCheck } from '@/server/verification/background-check'
import { recordChrcStep } from '@/server/verification/chrc'

export type RecordManualCheckState = { readonly error?: string }

const REFUSALS = {
  ALREADY_SATISFIED: 'This check has already been recorded.',
  WAIVED: 'This requirement was waived; there is nothing to record.',
  NOT_A_MANUAL_CHECK: 'This requirement is not a staff check.',
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
} as const

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function recordManualCheckAction(
  _previous: RecordManualCheckState,
  formData: FormData,
): Promise<RecordManualCheckState> {
  const { principal } = await requireStaffSession()
  const values = { instanceId: text(formData, 'instanceId') }

  const result = await runAsPrincipal(principal, {}, () => recordManualCheck(values))
  if (!result.ok) return { error: REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}

type RecordChrcStepState = { readonly error?: string }

const CHRC_REFUSALS = {
  ALREADY_SUBMITTED: 'This submission has already been recorded.',
  NOT_SUBMITTED: 'Record the DOH submission before the result.',
  ALREADY_RECORDED: "This check's result has already been recorded.",
  NOT_OUTSTANDING: 'This check is not waiting on this step.',
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
} as const

export async function recordChrcStepAction(
  _previous: RecordChrcStepState,
  formData: FormData,
): Promise<RecordChrcStepState> {
  const { principal } = await requireStaffSession()
  const values = { instanceId: text(formData, 'instanceId'), step: text(formData, 'step') }

  const result = await runAsPrincipal(principal, {}, () => recordChrcStep(values))
  if (!result.ok) return { error: CHRC_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}

type OrderBackgroundCheckState = { readonly error?: string }

const BACKGROUND_CHECK_REFUSALS: Record<BackgroundCheckOrderRefusal, string> = {
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
  ALREADY_ORDERED: 'A background check has already been ordered.',
  NOT_OUTSTANDING: 'This background check is not waiting to be ordered.',
  FCRA_NOT_SIGNED: 'The caregiver has not signed the FCRA disclosure. A check cannot be ordered without it.',
  NO_PACKAGE_CODE: 'Your agency has no background check package configured.',
  SUBJECT_INCOMPLETE: "The caregiver's legal name or date of birth is missing.",
}

export async function orderBackgroundCheckAction(
  _previous: OrderBackgroundCheckState,
  formData: FormData,
): Promise<OrderBackgroundCheckState> {
  const { principal } = await requireStaffSession()
  const values = { instanceId: text(formData, 'instanceId') }

  const result = await runAsPrincipal(principal, {}, () => orderBackgroundCheck(values))
  if (!result.ok) return { error: BACKGROUND_CHECK_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}

type AdjudicateBackgroundCheckState = { readonly error?: string }

const ADJUDICATION_REFUSALS: Record<BackgroundCheckAdjudicationRefusal, string> = {
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
  NOT_AWAITING_REVIEW: 'This background check is not waiting for a review decision.',
}

export async function adjudicateBackgroundCheckAction(
  _previous: AdjudicateBackgroundCheckState,
  formData: FormData,
): Promise<AdjudicateBackgroundCheckState> {
  const { principal } = await requireStaffSession()
  const values = { instanceId: text(formData, 'instanceId'), adjudication: text(formData, 'adjudication') }

  const result = await runAsPrincipal(principal, {}, () => adjudicateBackgroundCheck(values))
  if (!result.ok) return { error: ADJUDICATION_REFUSALS[result.reason] }

  revalidatePath('/checks')
  return {}
}
