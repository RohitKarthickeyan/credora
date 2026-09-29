import { z } from 'zod'

// The source of truth for the audit vocabulary. The Prisma enums AuditActorRole, AuditAction
// and AuditEntityType mirror these lists, because src/domain may not import src/db
// (ARCHITECTURE.md § Layers); keep the two in step.

// UserRole plus SYSTEM. A background job has no user and must not borrow a human's role, and
// SYSTEM is deliberately not a role anyone can log in as.
export const AUDIT_ACTOR_ROLES = [
  'CAREGIVER',
  'COORDINATOR',
  'SUPERVISOR',
  'AGENCY_ADMIN',
  'IMPLEMENTATION',
  'SYSTEM',
] as const

// The four verbs of the PRD's audit bullet, plus DELETE because SECURITY.md § Retention ends
// "Deletions are audited". A verb arrives with the use case that first writes one.
export const AUDIT_ACTIONS = ['VIEW', 'EDIT', 'EXPORT', 'SIGN_OFF', 'DELETE'] as const

export const AUDIT_ENTITY_TYPES = [
  'CAREGIVER',
  'MEDICAL_FILE',
  'EEOC_RECORD',
  'ACCEPTED_ISSUER',
  'ALAYACARE_MAPPING',
  'USER',
  'REQUIREMENT_TEMPLATE',
  'INBOUND_WEBHOOK',
  'AUDIT_LOG',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

// A camelCase column identifier. fieldName carries a column name, never a value
// (SECURITY.md § Audit log: "No values are stored in the audit log"), and no SSN, phone
// number, name or date can match this.
const COLUMN_IDENTIFIER = /^[a-z][A-Za-z0-9]*$/

export const auditActorSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('SYSTEM') }),
  z.strictObject({
    role: z.enum(AUDIT_ACTOR_ROLES).exclude(['SYSTEM']),
    id: z.string().min(1),
  }),
])

export const auditEntryInputSchema = z.strictObject({
  agencyId: z.string().min(1),
  action: z.enum(AUDIT_ACTIONS),
  entityType: z.enum(AUDIT_ENTITY_TYPES),
  entityId: z.string().min(1),
  fieldName: z
    .string()
    .regex(COLUMN_IDENTIFIER, 'fieldName carries a column name, never a value')
    .optional(),
  reason: z.string().trim().min(1).max(500).optional(),
})

export type AuditActor = z.infer<typeof auditActorSchema>
export type AuditContext = { actor: AuditActor; ip?: string }
export type AuditEntryInput = z.infer<typeof auditEntryInputSchema>
