'use server'

import { revalidatePath } from 'next/cache'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { type SignOffResult, signOffClearance } from '@/server/clearance/sign-off'
import {
  type RecordHealthScreeningResultResult,
  recordHealthScreeningResult,
} from '@/server/verification/health-screening'

type SignOffState = { readonly error?: string }

const REFUSALS: Record<Extract<SignOffResult, { ok: false }>['reason'], string> = {
  NO_REQUIREMENTS: 'No requirements are assigned to this caregiver yet.',
  BLOCKING_OUTSTANDING: 'A blocking requirement is no longer satisfied. Reload to see which.',
  NOT_IN_CLEARANCE:
    'This caregiver is not waiting for sign-off. They may already have been signed off or withdrawn.',
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function signOffClearanceAction(_previous: SignOffState, formData: FormData): Promise<SignOffState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () => signOffClearance({ caregiverId }))
  if (!result.ok) return { error: REFUSALS[result.reason] }

  revalidatePath(`/clearance/${caregiverId}`)
  return {}
}

type RecordResultState = { readonly error?: string }

const RESULT_REFUSALS: Record<Extract<RecordHealthScreeningResultResult, { ok: false }>['reason'], string> = {
  NOT_AWAITING_RESULT: 'This requirement is not waiting for a result. Reload to see its status.',
  CAREGIVER_WITHDRAWN: 'This caregiver has been withdrawn.',
}

export async function recordHealthScreeningResultAction(
  _previous: RecordResultState,
  formData: FormData,
): Promise<RecordResultState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')

  const result = await runAsPrincipal(principal, {}, () =>
    recordHealthScreeningResult({
      instanceId: text(formData, 'instanceId'),
      outcome: text(formData, 'outcome'),
      resultedOn: text(formData, 'resultedOn'),
    }),
  )
  if (!result.ok) return { error: RESULT_REFUSALS[result.reason] }

  revalidatePath(`/clearance/${caregiverId}`)
  return {}
}
