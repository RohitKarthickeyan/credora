import {
  type AlayaCareMappingChange,
  type StoredAlayaCareMapping,
  EMPTY_ALAYACARE_MAPPING,
  alayaCareMappingSchema,
  applyAlayaCareMappingChange,
} from '@/domain/sync/alayacare-mapping'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '../audit'
import { prisma } from '../prisma'

export type AlayaCareMappingWriteResult =
  | { readonly ok: true; readonly stored: StoredAlayaCareMapping }
  | { readonly ok: false; readonly reason: 'STALE' | 'DUPLICATE_KEY' | 'UNKNOWN_KEY' }

const STALE = { ok: false, reason: 'STALE' } as const

// A row that no longer parses (hand-edited, or written under a wider vocabulary) must stop the
// sync rather than project anything. The message names the agency and carries no value.
async function readStored(
  db: Pick<AuditedTx, 'alayaCareMapping'>,
  agencyId: string,
): Promise<StoredAlayaCareMapping> {
  const row = await db.alayaCareMapping.findUnique({ where: { agencyId } })
  if (row === null) return { version: 0, mapping: EMPTY_ALAYACARE_MAPPING }

  const parsed = alayaCareMappingSchema.safeParse(row.config)
  if (!parsed.success) {
    throw new Error(`The stored AlayaCare mapping for agency ${agencyId} does not parse.`)
  }
  return { version: row.version, mapping: parsed.data }
}

// Unguarded and uncached: T-111's job has no principal (OPEN-QUESTIONS 21), and a fresh read on
// every call is what makes a saved change take effect without a deploy.
export function findAlayaCareMapping(agencyId: string): Promise<StoredAlayaCareMapping> {
  return readStored(prisma, agencyId)
}

export function changeAlayaCareMapping(
  agencyId: string,
  expectedVersion: number,
  change: AlayaCareMappingChange,
): Promise<AlayaCareMappingWriteResult> {
  return runInAuditedTransaction(async (tx) => {
    const current = await readStored(tx, agencyId)
    if (current.version !== expectedVersion) return STALE

    const result = applyAlayaCareMappingChange(current.mapping, change)
    if (!result.ok) return result

    const version = expectedVersion + 1
    // Conditional writes: a count of 0 means a concurrent save won the race.
    const { count } =
      expectedVersion === 0
        ? await tx.alayaCareMapping.createMany({
            data: [{ agencyId, version, config: result.mapping }],
            skipDuplicates: true,
          })
        : await tx.alayaCareMapping.updateMany({
            where: { agencyId, version: expectedVersion },
            data: { config: result.mapping, version },
          })
    if (count === 0) return STALE

    // No key, code or source: SECURITY.md § Audit log stores that something changed, never a value.
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'ALAYACARE_MAPPING',
      entityId: agencyId,
      fieldName: change.kind === 'setCredentialCodes' ? 'credentialCodes' : 'customFields',
    })
    return { ok: true, stored: { version, mapping: result.mapping } }
  })
}
