import { env } from '@/lib/env'
import { prisma } from './prisma'

export type TableRowCount = { schema: string; table: string; rows: number }

type CatalogueTable = { schema: string; table: string; ident: string }

// This is the one place outside src/db/restricted/ that reaches into `medical` and `eeoc`.
// It is not an ADR-002 violation: it names no model and reads no value, so no accidental
// include: or join is possible. It is DDL-level maintenance driven by the Postgres
// catalogue, which is also why T-010's models need no change here.
function catalogueTables(): Promise<CatalogueTable[]> {
  return prisma.$queryRaw<CatalogueTable[]>`
    select table_schema as schema,
           table_name as table,
           quote_ident(table_schema) || '.' || quote_ident(table_name) as ident
    from information_schema.tables
    where table_schema in ('core', 'medical', 'eeoc') and table_type = 'BASE TABLE'
    order by table_schema, table_name
  `
}

type ForeignKeyEdge = { child: string; parent: string }

function foreignKeyEdges(): Promise<ForeignKeyEdge[]> {
  return prisma.$queryRaw<ForeignKeyEdge[]>`
    select quote_ident(cn.nspname) || '.' || quote_ident(cc.relname) as child,
           quote_ident(pn.nspname) || '.' || quote_ident(pc.relname) as parent
    from pg_constraint k
    join pg_class cc on cc.oid = k.conrelid
    join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = k.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
    where k.contype = 'f' and cn.nspname in ('core', 'medical', 'eeoc')
  `
}

const AUDIT_ENTRY = 'core."AuditEntry"'

async function buildEmptyStatement(): Promise<string> {
  const [tables, edges] = await Promise.all([catalogueTables(), foreignKeyEdges()])

  // Children first: a table is emptied only once no remaining table references it.
  const remaining = new Set(tables.map((table) => table.ident))
  const order: string[] = []
  while (remaining.size > 0) {
    const next = [...remaining].filter(
      (ident) =>
        !edges.some((edge) => edge.parent === ident && edge.child !== ident && remaining.has(edge.child)),
    )
    if (next.length === 0) {
      throw new Error(`emptyAllTables found a foreign-key cycle among: ${[...remaining].join(', ')}`)
    }
    for (const ident of next) {
      order.push(ident)
      remaining.delete(ident)
    }
  }

  // DELETE would fire AuditEntry's append-only row trigger; TRUNCATE bypasses it by design
  // (migration 20260923070035, ADR-010), and costs a lock only when there is a row to clear.
  const statements = order.map((ident) =>
    ident === AUDIT_ENTRY
      ? `IF EXISTS (SELECT 1 FROM ${ident}) THEN TRUNCATE ${ident}; END IF;`
      : `DELETE FROM ${ident};`,
  )
  return `DO $$ BEGIN ${statements.join(' ')} END $$`
}

let emptyStatement: Promise<string> | undefined

/**
 * Delete every row in core, medical and eeoc, children first, in one round trip. Refuses when
 * NODE_ENV is production. An ordered DELETE, not TRUNCATE: on these near-empty tables TRUNCATE
 * cost ~800 ms a call and DELETE ~5 ms (T-143).
 */
export async function emptyAllTables(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'emptyAllTables is a test and development helper and must never run in production.',
    )
  }

  // Identifiers cannot be parameterised, so the statement is assembled by hand. Every
  // identifier comes from quote_ident() over the catalogue, never from a caller.
  // public._prisma_migrations is deliberately left alone: wiping it would make the database
  // look unmigrated.
  emptyStatement ??= buildEmptyStatement()
  await prisma.$executeRawUnsafe(await emptyStatement)
}

/** Row count per table across the three schemas, ordered by schema then table. */
export async function tableRowCounts(): Promise<TableRowCount[]> {
  const tables = await catalogueTables()

  const counts: TableRowCount[] = []
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<{ rows: number }[]>(
      `select count(*)::int as rows from ${table.ident}`,
    )
    counts.push({ schema: table.schema, table: table.table, rows: rows[0]?.rows ?? 0 })
  }
  return counts
}

/** Names from public._prisma_migrations, oldest first. */
export async function appliedMigrationNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    select migration_name as name from public._prisma_migrations order by started_at asc
  `
  return rows.map((row) => row.name)
}
