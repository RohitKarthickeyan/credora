'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type { RawAnswers } from '@/domain/forms/answers'
import type { SectionIssues } from '@/domain/forms/validate'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { saveIntakeStep } from '@/server/intake/flow'
import type { AfterSave } from './_components/section-form'

const stepInputSchema = z.object({ stepId: z.string().min(1), then: z.enum(['next', 'overview']) })

export async function saveStep(stepId: string, answers: RawAnswers, then: AfterSave): Promise<SectionIssues> {
  const principal = await requireCaregiverSession()
  const input = stepInputSchema.parse({ stepId, then })
  const result = await runAsPrincipal(principal, {}, () =>
    saveIntakeStep({ caregiverId: principal.caregiverId, stepId: input.stepId, answers }),
  )

  if (result === null) redirect('/intake')
  if (!result.saved) return { invalid: result.invalid, missing: result.missing }
  revalidatePath('/intake')
  redirect(input.then === 'next' && result.next ? `/intake/${result.next}` : '/intake')
}
