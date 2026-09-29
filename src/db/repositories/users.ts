import type {
  StaffAccessChange,
  StaffUser,
  StaffUserInvite,
} from '@/domain/auth/staff-user'
import { STAFF_ROLES, staffUserInviteSchema } from '@/domain/auth/staff-user'
import type { AuditedTx } from '../audit'
import { prisma } from '../prisma'

// A declared read without agencyId (DATA-MODEL.md § Invariants, ADR-026): staff sign in with
// no tenant selector, so the row found by its globally unique email is what resolves the agency.
// The only function that selects passwordHash.
export function findUserForSignIn(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, agencyId: true, role: true, isActive: true, passwordHash: true },
  })
}

export function findUserForSession(agencyId: string, userId: string) {
  return prisma.user.findFirst({
    where: { agencyId, id: userId },
    select: { id: true, agencyId: true, role: true, isActive: true, fullName: true },
  })
}

const STAFF_ROLE_FILTER = { in: [...STAFF_ROLES] }

// passwordHash is never selected here: whether one is set is asked with a where filter.
const STAFF_USER_SELECT = { id: true, fullName: true, email: true, role: true, isActive: true } as const

type StaffUserRow = {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly role: string
  readonly isActive: boolean
}

function toStaffUser(row: StaffUserRow, invitePending: boolean): StaffUser {
  return { ...row, role: staffUserInviteSchema.shape.role.parse(row.role), invitePending }
}

export async function listStaffUsers(agencyId: string): Promise<readonly StaffUser[]> {
  const [rows, pending] = await Promise.all([
    prisma.user.findMany({
      where: { agencyId, role: STAFF_ROLE_FILTER },
      select: STAFF_USER_SELECT,
      orderBy: { fullName: 'asc' },
    }),
    prisma.user.findMany({
      where: { agencyId, role: STAFF_ROLE_FILTER, passwordHash: null },
      select: { id: true },
    }),
  ])
  const pendingIds = new Set(pending.map(({ id }) => id))
  return rows.map((row) => toStaffUser(row, pendingIds.has(row.id)))
}

export async function findStaffUser(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
): Promise<StaffUser | null> {
  const where = { agencyId, id: userId, role: STAFF_ROLE_FILTER }
  const row = await tx.user.findFirst({ where, select: STAFF_USER_SELECT })
  if (row === null) return null
  const pending = await tx.user.count({ where: { ...where, passwordHash: null } })
  return toStaffUser(row, pending === 1)
}

export function createStaffUser(
  tx: AuditedTx,
  agencyId: string,
  input: StaffUserInvite,
): Promise<{ readonly id: string }> {
  return tx.user.create({ data: { agencyId, ...input }, select: { id: true } })
}

/**
 * Locks the agency row before counting, so two admins demoting each other at once cannot each
 * count two and both succeed: under READ COMMITTED the second blocks here, and its count, a new
 * statement, sees the first's commit.
 */
export async function lockAgencyAndCountSignInAbleAdmins(
  tx: AuditedTx,
  agencyId: string,
): Promise<number> {
  await tx.$queryRaw`SELECT 1 FROM core."Agency" WHERE id = ${agencyId} FOR UPDATE`
  return tx.user.count({
    where: { agencyId, role: 'AGENCY_ADMIN', isActive: true, passwordHash: { not: null } },
  })
}

export async function updateStaffUserAccess(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
  change: StaffAccessChange,
): Promise<void> {
  await tx.user.updateMany({ where: { agencyId, id: userId, role: STAFF_ROLE_FILTER }, data: change })
}

export async function findPendingStaffUser(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
): Promise<{ readonly email: string; readonly fullName: string; readonly agencyName: string } | null> {
  const row = await tx.user.findFirst({
    where: { agencyId, id: userId, role: STAFF_ROLE_FILTER, isActive: true, passwordHash: null },
    select: { email: true, fullName: true, agency: { select: { name: true } } },
  })
  return row === null ? null : { email: row.email, fullName: row.fullName, agencyName: row.agency.name }
}

// The only writer of passwordHash, and only while the invite is still pending.
export async function setInvitedStaffPassword(
  tx: AuditedTx,
  agencyId: string,
  userId: string,
  passwordHash: string,
): Promise<{ readonly email: string } | null> {
  const updated = await tx.user.updateMany({
    where: { agencyId, id: userId, role: STAFF_ROLE_FILTER, isActive: true, passwordHash: null },
    data: { passwordHash },
  })
  if (updated.count === 0) return null
  return tx.user.findFirstOrThrow({ where: { agencyId, id: userId }, select: { email: true } })
}
