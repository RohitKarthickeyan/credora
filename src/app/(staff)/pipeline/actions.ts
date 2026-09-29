'use server'

import { revalidatePath } from 'next/cache'
import { withdrawCaregiverInputSchema } from '@/domain/pipeline/withdrawal'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { withdrawCaregiver } from '@/server/caregivers/withdraw'

export type WithdrawCaregiverState = { readonly error?: string; readonly reasonError?: string }

const REFUSALS = {
  ALREADY_WITHDRAWN: 'This caregiver has already been withdrawn. Your reason was not recorded.',
  ALREADY_ACTIVE: 'This caregiver is already active and can no longer be withdrawn.',
} as const

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function withdrawCaregiverAction(
  _previous: WithdrawCaregiverState,
  formData: FormData,
): Promise<WithdrawCaregiverState> {
  const { principal } = await requireStaffSession()
  const values = { caregiverId: text(formData, 'caregiverId'), reason: text(formData, 'reason') }
  const parsed = withdrawCaregiverInputSchema.safeParse(values)
  if (!parsed.success) {
    const issue = parsed.error.issues.find(({ path }) => path[0] === 'reason')
    if (issue !== undefined) return { reasonError: issue.message }
  }

  const result = await runAsPrincipal(principal, {}, () => withdrawCaregiver(values))
  if (!result.ok) return { error: REFUSALS[result.reason] }

  revalidatePath('/pipeline')
  revalidatePath(`/caregivers/${values.caregiverId}`)
  return {}
}
