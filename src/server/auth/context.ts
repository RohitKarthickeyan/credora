import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { runWithAuditContext } from '@/db/audit'
import type { Principal } from '@/domain/auth/role'
import { principalSchema } from '@/domain/auth/role'

const principalStore = new AsyncLocalStorage<Principal>()

/**
 * Establish who is acting for everything `fn` does. Called once at a boundary — a Server Action,
 * a route handler — and it establishes the authorization subject and the audit actor in the same
 * call, so the two cannot disagree and no caller can attribute an action to someone else
 * (ADR-015 § 1).
 *
 * The principal must be built from the `User` row, not from the session cookie: the cookie is an
 * authenticated pointer to a user id and carries no privilege. This function parses the shape it
 * is given; it cannot check that the caller read the right row, which is T-020's obligation.
 */
export function runAsPrincipal<T>(
  principal: Principal,
  request: { readonly ip?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const parsed = principalSchema.parse(principal)

  return principalStore.run(parsed, () =>
    runWithAuditContext({ actor: { role: parsed.role, id: parsed.id }, ip: request.ip }, fn),
  )
}

/**
 * The boundary for work with no user behind it: a queue job or a scheduled sweep. It establishes
 * an audit actor and deliberately no principal, so a guarded use case called from here throws
 * rather than borrowing a human's authority. `exit` clears any principal already established, so
 * that holds even when a job is drained from inside a request.
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return principalStore.exit(() => runWithAuditContext({ actor: { role: 'SYSTEM' } }, fn))
}

export function requirePrincipal(): Principal {
  const principal = principalStore.getStore()
  if (principal === undefined) {
    throw new Error(
      'No principal is established, so this call cannot be authorized. Wrap the boundary in ' +
        'runAsPrincipal from @/server/auth/context (SECURITY.md Authorization). A use case that ' +
        'cannot name its actor is refused rather than allowed anonymously.',
    )
  }
  return principal
}
