import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuditContext, AuditEntryInput } from '@/domain/audit/audit-entry'
import { auditEntryInputSchema } from '@/domain/audit/audit-entry'
import type { PrismaTransactionClient, RestrictedDelegate } from './prisma'
import { prisma } from './prisma'

declare const auditedBrand: unique symbol

/**
 * The transaction an audit entry may be written to. The brand is required, so the global
 * `prisma` client — structurally a superset — is a type error at a `writeAuditEntry` call
 * site, and `runInAuditedTransaction` is the only way to obtain one. The `RestrictedDelegate`s
 * are omitted for the same reason `CorePrismaClient` omits them (ADR-002): the restricted
 * stores are reached only through `src/db/restricted/`, which widens this type internally and
 * never exports the widened form. `auditEntry` is omitted for the third time on
 * the same reasoning: `writeAuditEntry` below is the only writer, so every entry is zod-validated
 * and carries the ambient actor rather than one a caller chose.
 */
export type AuditedTx = Omit<PrismaTransactionClient, RestrictedDelegate | 'auditEntry'> & {
  readonly [auditedBrand]: true
}

// Internal, never exported — the same local widening src/db/restricted/*.ts performs.
type AuditWriterTx = PrismaTransactionClient & AuditedTx

type AuditStore = { context: AuditContext | undefined; tx: AuditedTx | undefined }

const auditStore = new AsyncLocalStorage<AuditStore>()

/**
 * Establish the actor for everything `fn` does. Called once at a boundary — a Server Action,
 * a route handler or a queue job — so that no caller can attribute an action to someone else.
 */
export function runWithAuditContext<T>(context: AuditContext, fn: () => Promise<T>): Promise<T> {
  return auditStore.run({ context, tx: auditStore.getStore()?.tx }, fn)
}

function requireAuditContext(): AuditContext {
  const context = auditStore.getStore()?.context
  if (context === undefined) {
    throw new Error(
      'No audit context is established, so this action cannot be attributed to anyone. Wrap ' +
        'the boundary in runWithAuditContext from @/db/audit (SECURITY.md Audit log). An ' +
        'entry with no actor is the one row an audit log may not contain.',
    )
  }
  return context
}

/**
 * Run `fn` inside a transaction, joining the one already open rather than nesting: Prisma has
 * no nested interactive transaction, so nesting would give two transactions on two
 * connections and lose the guarantee that an audit entry cannot outlive a rolled-back
 * mutation. An inner call therefore cannot commit independently of its caller.
 */
export function runInAuditedTransaction<T>(fn: (tx: AuditedTx) => Promise<T>): Promise<T> {
  const store = auditStore.getStore()
  if (store?.tx !== undefined) return fn(store.tx)

  return prisma.$transaction((client) => {
    const tx = client as PrismaTransactionClient & AuditedTx
    return auditStore.run({ context: store?.context, tx }, () => fn(tx))
  })
}

/** Write one entry. The actor comes from the context, never from a parameter. */
export async function writeAuditEntry(tx: AuditedTx, entry: AuditEntryInput): Promise<void> {
  const input = auditEntryInputSchema.parse(entry)
  const { actor, ip } = requireAuditContext()
  const writer = tx as AuditWriterTx

  await writer.auditEntry.create({
    data: {
      agencyId: input.agencyId,
      actorId: actor.role === 'SYSTEM' ? null : actor.id,
      actorRole: actor.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName ?? null,
      reason: input.reason ?? null,
      ip: ip ?? null,
    },
  })
}
