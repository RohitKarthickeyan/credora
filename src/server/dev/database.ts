import { appliedMigrationNames, emptyAllTables, tableRowCounts } from '@/db/maintenance'
import type { TableRowCount } from '@/db/maintenance'
import { env } from '@/lib/env'

export type DevDatabaseSnapshot = {
  connection: string
  appliedMigrations: string[]
  tables: TableRowCount[]
}

export async function devDatabaseSnapshot(): Promise<DevDatabaseSnapshot> {
  const [appliedMigrations, tables] = await Promise.all([appliedMigrationNames(), tableRowCounts()])

  // DATABASE_URL carries the password, so only the host, port and database name are composed
  // out of it. It is never returned, rendered or logged verbatim.
  const url = new URL(env.DATABASE_URL)

  return {
    connection: `${url.pathname.replace(/^\//, '')}@${url.host}`,
    appliedMigrations,
    tables,
  }
}

export async function resetDevDatabase(): Promise<void> {
  await emptyAllTables()
}
