import { z } from 'zod'

// The source of truth for the role names. The Prisma enum `UserRole` mirrors this list,
// because src/domain may not import src/db (ARCHITECTURE.md § Layers); keep the two in
// step. SYSTEM is deliberately absent: it is an audit
// actor, not a role anyone logs in as (AUDIT_ACTOR_ROLES in src/domain/audit/audit-entry.ts).
const USER_ROLES = [
  'CAREGIVER',
  'COORDINATOR',
  'SUPERVISOR',
  'AGENCY_ADMIN',
  'IMPLEMENTATION',
] as const

export type UserRole = (typeof USER_ROLES)[number]

// MEDICAL_RESULT and MEDICAL_DETAIL are two classes because DATA-MODEL.md § Field groups splits
// health screening in two on purpose: the pass/fail + date needed for clearance lives in `core`
// as a requirement instance, the clinical detail lives in the `medical` schema. "Clearance never
// needs to read `medical`", so the supervisor's results access is a `core` read with its own
// class rather than a licence to reach the restricted store.
export const DATA_CLASSES = [
  'OWN_RECORD',
  'OWN_MEDICAL',
  'CAREGIVER_RECORD',
  'SENSITIVE_FIELD',
  'CLEARANCE',
  'MEDICAL_RESULT',
  'MEDICAL_DETAIL',
  'EEOC_ROW',
  'EEOC_AGGREGATE',
  'CONFIGURATION',
  'REPORT',
] as const

export type DataClass = (typeof DATA_CLASSES)[number]

/**
 * `SECURITY.md § Roles and access` transcribed. It is a **ceiling**: the most any role may ever
 * be granted over a class of data. It grants nothing on its own — an action in
 * `src/server/auth/policy.ts` does that — but no action may exceed it.
 *
 * `MEDICAL_DETAIL` and `EEOC_ROW` are empty and stay empty: "EEOC data is visible to **no role**
 * in the UI", and neither a coordinator nor a supervisor may see medical questionnaire detail.
 * Together with the registry's non-empty-roles invariant, that makes those two classes
 * unreachable by any action anyone can register.
 */
export const ROLE_ACCESS: Readonly<Record<DataClass, readonly UserRole[]>> = {
  OWN_RECORD: ['CAREGIVER'],
  OWN_MEDICAL: ['CAREGIVER'],
  CAREGIVER_RECORD: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN'],
  SENSITIVE_FIELD: ['COORDINATOR', 'AGENCY_ADMIN'],
  CLEARANCE: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN'],
  MEDICAL_RESULT: ['COORDINATOR', 'SUPERVISOR'],
  MEDICAL_DETAIL: [],
  EEOC_ROW: [],
  EEOC_AGGREGATE: ['AGENCY_ADMIN'],
  CONFIGURATION: ['AGENCY_ADMIN', 'IMPLEMENTATION'],
  REPORT: ['COORDINATOR', 'AGENCY_ADMIN'],
}

/**
 * Who is acting. `agencyId` is present on every principal because there is no unscoped read
 * (DATA-MODEL.md invariant 5) and because "all caregivers **in the agency**" is half of what a
 * coordinator may do. `caregiverId` is structurally present only on the one role that has a
 * record of its own, so a staff principal carrying one is unrepresentable rather than merely
 * wrong.
 *
 * The trustworthy source is the `User` row, never the cookie: the caller reads the signed
 * session cookie for a user id, loads `User { id, role, agencyId, isActive }` by that id,
 * refuses an inactive user, and builds the principal from the row. A role or an agency changed
 * by an admin then takes effect on the next request with no cookie invalidation. That contract
 * is T-020's to keep; this module can only state it.
 */
export const principalSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('CAREGIVER'),
    id: z.string().min(1),
    agencyId: z.string().min(1),
    caregiverId: z.string().min(1),
  }),
  z.strictObject({
    role: z.enum(USER_ROLES).exclude(['CAREGIVER']),
    id: z.string().min(1),
    agencyId: z.string().min(1),
  }),
])

export type Principal = z.infer<typeof principalSchema>
