'use server'

import { redirect } from 'next/navigation'
import { referenceResponseSchema } from '@/domain/requirements/reference-check'
import { submitReferenceResponse } from '@/server/verification/references'

type SubmitReferenceState = { readonly error?: string; readonly done?: true }

function text(formData: FormData, field: string): string | undefined {
  const value = formData.get(field)
  return typeof value === 'string' ? value : undefined
}

export async function submitReferenceAction(
  token: string,
  _previous: SubmitReferenceState,
  formData: FormData,
): Promise<SubmitReferenceState> {
  const answers = {
    workedWith: text(formData, 'workedWith'),
    wouldRecommend: text(formData, 'wouldRecommend'),
    comments: text(formData, 'comments'),
  }
  // Validated here so a bad submission never consumes the link; the use case parses it again.
  if (!referenceResponseSchema.safeParse(answers).success) {
    return { error: 'Answer both questions. Comments can be up to 500 characters.' }
  }

  const result = await submitReferenceResponse(token, answers)
  // The page itself explains an invalid, expired, used or closed link.
  if (!result.ok || result.value === 'CLOSED') redirect(`/r/reference/${token}`)
  return { done: true }
}
