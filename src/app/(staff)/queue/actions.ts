'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { queueDecisionInputSchema } from '@/domain/documents/staff-decision'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { retryStoppedJob } from '@/server/review/exception-queue'
import {
  type DecideFlaggedDocumentResult,
  type WaiveRequirementResult,
  decideFlaggedDocument,
  waiveRequirement,
} from '@/server/review/exception-resolution'

export type DecideExceptionState = { readonly error?: string }

const REFUSALS = {
  NO_LONGER_FLAGGED:
    'This document no longer needs a decision. It was decided, re-uploaded or withdrawn since the page loaded.',
  NOT_WAIVABLE: 'This requirement no longer needs attention, so it was not waived.',
} as const

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function decideExceptionAction(
  _previous: DecideExceptionState,
  formData: FormData,
): Promise<DecideExceptionState> {
  const { principal } = await requireStaffSession()
  const parsed = queueDecisionInputSchema.safeParse({
    instanceId: text(formData, 'instanceId'),
    uploadedDocumentId: text(formData, 'uploadedDocumentId'),
    decision: text(formData, 'decision'),
  })
  if (!parsed.success) return { error: 'Choose a decision.' }

  const { instanceId, uploadedDocumentId, decision } = parsed.data
  const result = await runAsPrincipal<DecideFlaggedDocumentResult | WaiveRequirementResult>(principal, {}, () =>
    decision === 'WAIVED'
      ? waiveRequirement({ instanceId })
      : decideFlaggedDocument({ instanceId, uploadedDocumentId, decision }),
  )

  revalidatePath('/queue')
  return result.ok ? {} : { error: REFUSALS[result.reason] }
}

// A NOT_STOPPED refusal needs no message: the refreshed page no longer lists the job.
export async function retryStoppedJobAction(formData: FormData): Promise<void> {
  const { principal } = await requireStaffSession()
  const jobId = z.uuid().safeParse(text(formData, 'jobId'))
  if (!jobId.success) return

  await runAsPrincipal(principal, {}, () => retryStoppedJob({ jobId: jobId.data }))
  revalidatePath('/queue')
}
