'use server'

import { revalidatePath } from 'next/cache'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { linkTrainingAccount, scheduleTrainingImport } from '@/server/training/training-hours'

type TrainingActionState = { readonly error?: string }

type Refusal<R> = Extract<R, { ok: false }> extends { reason: infer K extends string } ? K : never

const LINK_REFUSALS = {
  CAREGIVER_NOT_FOUND: 'That caregiver no longer exists. Refresh the page.',
  CAREGIVER_WITHDRAWN: 'That caregiver has been withdrawn. Refresh the page.',
  ALREADY_LINKED: 'That caregiver is already linked to a training platform id. Refresh the page.',
  ID_TAKEN: 'This training platform id is already linked to another caregiver. Refresh the page.',
} as const satisfies Record<Refusal<Awaited<ReturnType<typeof linkTrainingAccount>>>, string>

const SCHEDULE_REFUSALS = {
  INVALID_SOURCE: 'Enter the export file name or path, for example completions.csv.',
} as const satisfies Record<Refusal<Awaited<ReturnType<typeof scheduleTrainingImport>>>, string>

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function linkTrainingAccountAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')
  if (caregiverId === '') return { error: 'Choose the caregiver this platform id belongs to.' }

  const result = await runAsPrincipal(principal, {}, () =>
    linkTrainingAccount({ caregiverId, externalCaregiverId: text(formData, 'externalCaregiverId') }),
  )
  if (!result.ok) return { error: LINK_REFUSALS[result.reason] }

  revalidatePath('/training')
  return {}
}

export async function scheduleTrainingImportAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const { principal } = await requireStaffSession()

  const result = await runAsPrincipal(principal, {}, () =>
    scheduleTrainingImport({ sourceRef: text(formData, 'sourceRef') }),
  )
  if (!result.ok) return { error: SCHEDULE_REFUSALS[result.reason] }

  revalidatePath('/training')
  return {}
}
