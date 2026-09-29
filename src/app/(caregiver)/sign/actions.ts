'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { SendProblem } from '@/domain/documents/envelope'
import { getPort } from '@/integrations/registry'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import type { SendDocumentSetResult } from '@/server/forms/signing'
import { sendOwnDocumentSet } from '@/server/forms/signing'

type PrepareState = { readonly error?: string }

const CONTACT_AGENCY =
  'Your agency needs to fix something before you can sign. Please contact them.'

// Field names never reach the caregiver's screen; they are in the result for staff tooling.
const COPY: Record<Exclude<Extract<SendDocumentSetResult, { ok: false }>['reason'], 'cannot-generate'>, string> = {
  'not-ready': 'Finish your questions first.',
  'requirements-ambiguous': CONTACT_AGENCY,
  'nothing-to-sign': 'There is nothing for you to sign right now.',
  'no-generator': CONTACT_AGENCY,
  'no-signer': 'Add your legal name and email address to your questions first.',
}

const PROBLEM_COPY: Record<SendProblem['kind'], string> = {
  'vaccination-questions': 'Answer the vaccination questions first.',
  'missing-answers': 'A few answers are still missing. Go back to your questions.',
  'needs-staff': CONTACT_AGENCY,
}

export async function prepareDocuments(): Promise<PrepareState> {
  const principal = await requireCaregiverSession()
  const result = await runAsPrincipal(principal, {}, () =>
    sendOwnDocumentSet({ caregiverId: principal.caregiverId, storage: getPort('storage') }),
  )
  if (!result.ok) {
    if (result.reason !== 'cannot-generate') return { error: COPY[result.reason] }
    const first = result.problems[0]
    return { error: first === undefined ? CONTACT_AGENCY : PROBLEM_COPY[first.kind] }
  }

  revalidatePath('/sign')
  redirect('/sign')
}
