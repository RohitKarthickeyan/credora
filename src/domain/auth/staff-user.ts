import { z } from 'zod'
import { staffCredentialsSchema } from './credentials'
import type { UserRole } from './role'

// CAREGIVER is not assignable: caregivers are Caregiver rows who sign in by email.
export const STAFF_ROLES = [
  'COORDINATOR',
  'SUPERVISOR',
  'AGENCY_ADMIN',
  'IMPLEMENTATION',
] as const satisfies readonly UserRole[]
export type StaffRole = (typeof STAFF_ROLES)[number]

// The email is the sign-in schema's own, so an invited address is stored exactly as sign-in
// looks it up.
export const staffUserInviteSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(200),
  email: staffCredentialsSchema.shape.email,
  role: z.enum(STAFF_ROLES),
})
export type StaffUserInvite = z.infer<typeof staffUserInviteSchema>

export const NEW_PASSWORD_MIN_LENGTH = 12

// Never trimmed, and no composition rules (NIST SP 800-63B). bcrypt ignores everything past
// 72 UTF-8 bytes, so a longer password is refused rather than silently truncated.
export const newPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_MIN_LENGTH, 'Use at least 12 characters.')
  .refine(
    (password) => new TextEncoder().encode(password).length <= 72,
    'That password is too long. Use at most 72 bytes (fewer if it has accented letters or emoji).',
  )

export type StaffUser = {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly role: StaffRole
  readonly isActive: boolean
  readonly invitePending: boolean
}

export type StaffAccessChange = { readonly role: StaffRole } | { readonly isActive: boolean }

export type StaffUserRefusal = 'NOT_FOUND' | 'EMAIL_TAKEN' | 'LAST_ADMIN' | 'NOT_PENDING'
export type StaffUserWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: StaffUserRefusal }

/**
 * Only an admin can manage users, so an agency left with no admin who can sign in cannot recover
 * in-product. An invited admin does not count: they cannot sign in, and only an admin can resend
 * their invite.
 */
export function lastAdminRefusal(
  target: Pick<StaffUser, 'role' | 'isActive' | 'invitePending'>,
  change: StaffAccessChange,
  signInAbleAdmins: number,
): 'LAST_ADMIN' | null {
  const counts = target.role === 'AGENCY_ADMIN' && target.isActive && !target.invitePending
  const removes = 'role' in change ? change.role !== 'AGENCY_ADMIN' : !change.isActive
  return counts && removes && signInAbleAdmins <= 1 ? 'LAST_ADMIN' : null
}
