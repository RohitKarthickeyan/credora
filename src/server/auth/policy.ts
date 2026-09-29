import 'server-only'
import { auditEntryInputSchema } from '@/domain/audit/audit-entry'
import type { DataClass, Principal, UserRole } from '@/domain/auth/role'
import { requirePrincipal } from './context'

type ActionPolicy = {
  readonly dataClass: DataClass
  readonly roles: readonly UserRole[]
  readonly selfOnly?: true
  readonly requiresReason?: true
}

/**
 * Every operation on caregiver data, registered against the class of data it touches and the
 * roles permitted to perform it. Every later task appends its row here (MODULES.md § Files that
 * many tasks touch). A row may narrow `ROLE_ACCESS` and must never widen it; nothing
 * checks this any more, so a new row needs a look at its roles.
 */
const ACTION_POLICIES = {
  'caregiver.viewOwn': { dataClass: 'OWN_RECORD', roles: ['CAREGIVER'], selfOnly: true },
  'caregiver.editOwn': { dataClass: 'OWN_RECORD', roles: ['CAREGIVER'], selfOnly: true },
  'caregiver.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'caregiverField.reveal': {
    dataClass: 'SENSITIVE_FIELD',
    roles: ['COORDINATOR', 'AGENCY_ADMIN'],
    requiresReason: true,
  },
  'clearance.view': {
    dataClass: 'CLEARANCE',
    roles: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN'],
  },
  // Sign-off is the clinical supervisor's, and an agency admin does not inherit it: there is no
  // wildcard and no superuser (PRD § Users and roles; SECURITY.md gives the admin
  // "Configuration, users, reports").
  'clearance.signOff': { dataClass: 'CLEARANCE', roles: ['SUPERVISOR'] },
  'medicalResult.view': { dataClass: 'MEDICAL_RESULT', roles: ['COORDINATOR', 'SUPERVISOR'] },
  'medicalFile.viewOwn': { dataClass: 'OWN_MEDICAL', roles: ['CAREGIVER'], selfOnly: true },
  'medicalFile.editOwn': { dataClass: 'OWN_MEDICAL', roles: ['CAREGIVER'], selfOnly: true },
  // OWN_RECORD, not EEOC_ROW: EEOC_ROW is the read class that must stay empty, and a caregiver
  // submitting their own form reads nothing.
  'eeocSelfIdentification.submitOwn': { dataClass: 'OWN_RECORD', roles: ['CAREGIVER'], selfOnly: true },
  'eeocReport.view': { dataClass: 'EEOC_AGGREGATE', roles: ['AGENCY_ADMIN'] },
  'successMetrics.view': { dataClass: 'REPORT', roles: ['AGENCY_ADMIN'] },
  'requirementTemplate.manage': {
    dataClass: 'CONFIGURATION',
    roles: ['AGENCY_ADMIN', 'IMPLEMENTATION'],
  },
  'user.manage': { dataClass: 'CONFIGURATION', roles: ['AGENCY_ADMIN'] },
  'issuerAllowlist.manage': { dataClass: 'CONFIGURATION', roles: ['AGENCY_ADMIN', 'IMPLEMENTATION'] },
  'pipeline.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'caregiver.invite': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'caregiver.withdraw': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'alayaCareMapping.manage': {
    dataClass: 'CONFIGURATION',
    roles: ['AGENCY_ADMIN', 'IMPLEMENTATION'],
  },
  'manualCheck.list': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'manualCheck.record': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'caregiver.correctEmail': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'envelope.void': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'chrc.list': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'chrc.record': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'backgroundCheck.list': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'backgroundCheck.order': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  // Who may decide a CONSIDER is an open product question; a separate row so narrowing it is one line.
  'backgroundCheck.adjudicate': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'reference.list': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'reference.request': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'reference.recordResponse': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  // Who may decide a reference check in review is an open product question; a separate row so narrowing it is one line.
  'reference.decide': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'exceptionQueue.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'weeklySample.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'exceptionQueue.decide': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  // Who may waive is OPEN-QUESTIONS 38; kept a separate row so narrowing it is one line.
  'requirement.waive': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  // Narrows the MEDICAL_RESULT ceiling to the clinical supervisor: a coordinator sees a result, never records one.
  'healthScreening.record': { dataClass: 'MEDICAL_RESULT', roles: ['SUPERVISOR'] },
  'alayaCareSync.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'alayaCareSync.resolve': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'training.view': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'training.link': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'AGENCY_ADMIN'] },
  'trainingImport.schedule': { dataClass: 'CONFIGURATION', roles: ['AGENCY_ADMIN'] },
} as const satisfies Record<string, ActionPolicy>

type PolicyAction = keyof typeof ACTION_POLICIES

export type PolicySubject = { readonly caregiverId?: string; readonly reason?: string }

// The reason a reveal is denied for and the reason the audit log refuses to store are one
// constraint, not two (CONVENTIONS.md § Code: never declared twice).
const reasonSchema = auditEntryInputSchema.shape.reason.unwrap()

export class ForbiddenError extends Error {
  // The message names the action and the role and nothing else: no caregiver id, no field name,
  // no reason text. It is thrown, logged once at the boundary, and mapped to a response by T-020.
  constructor(
    readonly action: PolicyAction,
    readonly role: UserRole,
  ) {
    super(`${role} is not permitted to perform ${action}.`)
    this.name = 'ForbiddenError'
  }
}

export function can(principal: Principal, action: PolicyAction, subject?: PolicySubject): boolean {
  // Typed as optional because an unregistered name can still arrive through a cast or from
  // untyped JavaScript, and the answer there is no rather than a crash.
  const policy: ActionPolicy | undefined = ACTION_POLICIES[action]
  if (policy === undefined) return false
  if (!policy.roles.includes(principal.role)) return false

  if (policy.selfOnly === true) {
    if (principal.role !== 'CAREGIVER') return false
    if (subject?.caregiverId !== principal.caregiverId) return false
  }

  if (policy.requiresReason === true && !reasonSchema.safeParse(subject?.reason).success) {
    return false
  }

  return true
}

function assertCan(
  principal: Principal,
  action: PolicyAction,
  subject?: PolicySubject,
): void {
  if (!can(principal, action, subject)) throw new ForbiddenError(action, principal.role)
}

export type UseCase<I, O> = ((input: I) => Promise<O>) & { readonly policyAction: PolicyAction }

// Makes a missing `caregiverId` or `reason` a compile error at the defineUseCase call site. The
// guard re-checks both at runtime; this is the early warning, that is the guarantee.
type SubjectFor<A extends PolicyAction> = ((typeof ACTION_POLICIES)[A] extends { selfOnly: true }
  ? { readonly caregiverId: string }
  : unknown) &
  ((typeof ACTION_POLICIES)[A] extends { requiresReason: true }
    ? { readonly reason: string }
    : unknown)

/**
 * The only way to write a use case. Authorization is pure and runs entirely before any
 * transaction opens, so a denied call costs no connection and `run` is never reached with an
 * unauthorized principal. Every exported function under `src/server/**` should be produced by
 * this.
 */
export function defineUseCase<A extends PolicyAction, I extends PolicySubject & SubjectFor<A>, O>(
  action: A,
  run: (context: { readonly principal: Principal; readonly input: I }) => Promise<O>,
): UseCase<I, O> {
  const useCase = async (input: I): Promise<O> => {
    const principal = requirePrincipal()
    assertCan(principal, action, input)
    return run({ principal, input })
  }

  return Object.defineProperty(useCase, 'policyAction', {
    value: action,
    enumerable: false,
  }) as UseCase<I, O>
}
