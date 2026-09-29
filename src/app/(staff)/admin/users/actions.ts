'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { StaffUserRefusal, StaffUserWriteResult } from '@/domain/auth/staff-user'
import { STAFF_ROLES, staffUserInviteSchema } from '@/domain/auth/staff-user'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import {
  changeStaffRole,
  inviteStaffUser,
  resendStaffInvite,
  resetStaffMfa,
  setStaffUserActive,
} from '@/server/users/staff-users'

export type InviteStaffState = {
  readonly error?: string
  readonly fieldErrors?: { readonly fullName?: string; readonly email?: string; readonly role?: string }
  readonly values?: { readonly fullName: string; readonly email: string; readonly role: string }
  readonly invited?: string
}

export type StaffUserControlState = { readonly error?: string; readonly notice?: string }

const REFUSALS: Record<StaffUserRefusal, string> = {
  EMAIL_TAKEN: 'This email already has a Credora account.',
  LAST_ADMIN:
    'The agency needs at least one active admin who can sign in. Make someone else an admin first.',
  NOT_FOUND: 'This user no longer exists.',
  NOT_PENDING:
    'This person has already set a password or is deactivated, so there is no invite to resend.',
}

const roleSchema = z.enum(STAFF_ROLES)

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

function controlState(result: StaffUserWriteResult, notice?: string): StaffUserControlState {
  if (!result.ok) return { error: REFUSALS[result.reason] }
  revalidatePath('/admin/users')
  return notice === undefined ? {} : { notice }
}

export async function inviteStaffUserAction(
  _previous: InviteStaffState,
  formData: FormData,
): Promise<InviteStaffState> {
  const { principal } = await requireStaffSession()
  const values = {
    fullName: text(formData.get('fullName')),
    email: text(formData.get('email')),
    role: text(formData.get('role')),
  }
  const parsed = staffUserInviteSchema.safeParse(values)
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error)
    return {
      fieldErrors: {
        fullName: fieldErrors.fullName?.[0],
        email: fieldErrors.email?.[0],
        role: fieldErrors.role?.[0],
      },
      values,
    }
  }

  const result = await runAsPrincipal(principal, {}, () => inviteStaffUser(parsed.data))
  if (!result.ok) return { error: REFUSALS[result.reason], values }

  revalidatePath('/admin/users')
  return { invited: parsed.data.email }
}

export async function changeStaffRoleAction(
  userId: string,
  _previous: StaffUserControlState,
  formData: FormData,
): Promise<StaffUserControlState> {
  const { principal } = await requireStaffSession()
  const role = roleSchema.safeParse(formData.get('role'))
  if (!role.success) return { error: 'Choose a role.' }

  const result = await runAsPrincipal(principal, {}, () =>
    changeStaffRole({ userId, role: role.data }),
  )
  return controlState(result)
}

export async function setStaffUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<StaffUserControlState> {
  const { principal } = await requireStaffSession()
  const result = await runAsPrincipal(principal, {}, () => setStaffUserActive({ userId, isActive }))
  return controlState(result)
}

export async function resendStaffInviteAction(userId: string): Promise<StaffUserControlState> {
  const { principal } = await requireStaffSession()
  const result = await runAsPrincipal(principal, {}, () => resendStaffInvite({ userId }))
  return controlState(
    result,
    'A new invite email is queued. The old link stops working once it is sent.',
  )
}

export async function resetStaffMfaAction(userId: string): Promise<StaffUserControlState> {
  const { principal } = await requireStaffSession()
  const result = await runAsPrincipal(principal, {}, () => resetStaffMfa({ userId }))
  return controlState(
    result,
    'Two-step sign-in is reset. They will set it up again the next time they sign in.',
  )
}
