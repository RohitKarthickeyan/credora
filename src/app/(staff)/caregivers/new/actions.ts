'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { inviteCaregiverInputSchema } from '@/domain/pipeline/invite'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { inviteCaregiver } from '@/server/caregivers/invite'

const FIELDS = [
  'legalFirstName',
  'legalLastName',
  'email',
  'mobilePhone',
  'workState',
  'serviceType',
  'payer',
] as const

type Field = (typeof FIELDS)[number]

export type InviteFormState = {
  readonly error?: string
  readonly fieldErrors?: Partial<Record<Field, string>>
  readonly values?: Readonly<Record<Field, string>>
}

function text(formData: FormData, field: Field): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

export async function inviteCaregiverAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const { principal } = await requireStaffSession()
  const values = {
    legalFirstName: text(formData, 'legalFirstName'),
    legalLastName: text(formData, 'legalLastName'),
    email: text(formData, 'email'),
    mobilePhone: text(formData, 'mobilePhone'),
    workState: text(formData, 'workState'),
    serviceType: text(formData, 'serviceType'),
    payer: text(formData, 'payer'),
  }
  const parsed = inviteCaregiverInputSchema.safeParse(values)
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error)
    return {
      fieldErrors: Object.fromEntries(FIELDS.map((field) => [field, fieldErrors[field]?.[0]])),
      values,
    }
  }

  const result = await runAsPrincipal(principal, {}, () => inviteCaregiver(values))
  if (!result.ok) {
    return {
      error:
        result.reason === 'EMAIL_IN_USE'
          ? 'A caregiver in your agency already has this email address.'
          : result.reason === 'PHONE_IN_USE'
            ? 'A caregiver in your agency already has this mobile number.'
            : `The requirement templates for ${result.keys.join(', ')} conflict, so this ` +
            "caregiver's requirement list cannot be built. An administrator must fix the " +
            'templates before this invite can be sent.',
      values,
    }
  }

  revalidatePath('/pipeline')
  redirect('/pipeline')
}
