'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type {
  AcceptedIssuerInput,
  AcceptedIssuerWriteResult,
} from '@/domain/documents/accepted-issuer'
import { acceptedIssuerInputSchema } from '@/domain/documents/accepted-issuer'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import {
  addAcceptedIssuer,
  retireAcceptedIssuer,
  updateAcceptedIssuer,
} from '@/server/review/accepted-issuers'

export type IssuerFormState = {
  readonly error?: string
  readonly fieldErrors?: { readonly name?: string; readonly kind?: string }
  readonly values?: { readonly name: string; readonly kind: string }
}

const REFUSALS: Record<Extract<AcceptedIssuerWriteResult, { ok: false }>['reason'], string> = {
  DUPLICATE_NAME: 'An accepted issuer with this name already exists.',
  NOT_FOUND: 'This issuer no longer exists or has been retired.',
}

function readForm(formData: FormData) {
  const raw = { name: formData.get('name'), kind: formData.get('kind') }
  return {
    parsed: acceptedIssuerInputSchema.safeParse(raw),
    values: {
      name: typeof raw.name === 'string' ? raw.name : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
    },
  }
}

function invalid(error: z.ZodError<AcceptedIssuerInput>, values: IssuerFormState['values']): IssuerFormState {
  const { fieldErrors } = z.flattenError(error)
  return { fieldErrors: { name: fieldErrors.name?.[0], kind: fieldErrors.kind?.[0] }, values }
}

export async function addIssuer(
  _previous: IssuerFormState,
  formData: FormData,
): Promise<IssuerFormState> {
  const { principal } = await requireStaffSession()
  const { parsed, values } = readForm(formData)
  if (!parsed.success) return invalid(parsed.error, values)

  const result = await runAsPrincipal(principal, {}, () => addAcceptedIssuer(parsed.data))
  if (!result.ok) return { error: REFUSALS[result.reason], values }

  revalidatePath('/admin/issuers')
  return {}
}

export async function updateIssuer(
  id: string,
  _previous: IssuerFormState,
  formData: FormData,
): Promise<IssuerFormState> {
  const { principal } = await requireStaffSession()
  const { parsed, values } = readForm(formData)
  if (!parsed.success) return invalid(parsed.error, values)

  const result = await runAsPrincipal(principal, {}, () =>
    updateAcceptedIssuer({ id, ...parsed.data }),
  )
  if (!result.ok) return { error: REFUSALS[result.reason], values }

  revalidatePath('/admin/issuers')
  redirect('/admin/issuers')
}

export async function retireIssuer(id: string): Promise<void> {
  const { principal } = await requireStaffSession()
  const result = await runAsPrincipal(principal, {}, () => retireAcceptedIssuer({ id }))
  if (result.ok) revalidatePath('/admin/issuers')
}
