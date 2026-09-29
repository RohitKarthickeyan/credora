import { revalidatePath } from 'next/cache'
import type { RevealSensitiveFieldState } from '@/app/_components/sensitive'
import { Sensitive } from '@/app/_components/sensitive'
import type { Principal } from '@/domain/auth/role'
import { revealSensitiveFieldInputSchema } from '@/domain/masking/sensitive-field'
import { requirePrincipal, runAsPrincipal } from '@/server/auth/context'
import { revealSensitiveField } from '@/server/caregivers/reveal-sensitive-field'
import { devDatabaseSnapshot, resetDevDatabase } from '@/server/dev/database'
import type { ProbeSeam } from '@/server/dev/audit-probe'
import { auditProbe } from '@/server/dev/audit-probe'

// A principal is normally built from a User row by T-020's session layer. There is none yet, and
// the probe only has to be *a* principal the policy permits, so it is written here rather than
// read: this file is never an entrypoint in a production build (ADR-011).
const PROBE_PRINCIPAL: Principal = {
  role: 'COORDINATOR',
  id: 'dev-probe-user',
  agencyId: 'dev-probe-agency',
}

// Read back by the next render of this page, which the action triggers with revalidatePath. The
// probe reports four booleans and has nowhere else to put them: a dev tool that persisted them
// would need a table, and returning them would need a client component.
let lastProbe: readonly ProbeSeam[] = []

export default async function DevToolsPage() {
  const snapshot = await devDatabaseSnapshot()

  async function reset() {
    'use server'
    // Deliberate, and the only permitted deviation from CONVENTIONS.md § Server / client
    // boundary (authenticate → authorize → validate → use case → revalidate): there is no
    // session system, no policy module and no input until T-020. It is acceptable only
    // because next.config.ts excludes this file from the production build, so this action has
    // no production endpoint. A runtime NODE_ENV guard would not buy the same exemption.
    await resetDevDatabase()
    revalidatePath('/dev')
  }

  async function runAuditProbe() {
    'use server'
    // Exempt from the authenticate → authorize → validate → use case sequence for the same
    // ADR-011 reason as reset() above. It is nonetheless the real thing being measured: whether
    // a principal established here is still readable from the use case Next dispatches into.
    lastProbe = await runAsPrincipal(PROBE_PRINCIPAL, {}, async () => {
      const seams = await auditProbe({ caregiverId: 'dev-probe-caregiver' })
      revalidatePath('/dev')
      const held = requirePrincipal().id === PROBE_PRINCIPAL.id
      return [...seams, { name: 'after revalidatePath in the same action', pass: held }]
    })
  }

  async function revealDevSsn(
    _previous: RevealSensitiveFieldState,
    formData: FormData,
  ): Promise<RevealSensitiveFieldState> {
    'use server'
    // ADR-011 exempts the authenticate step only: PROBE_PRINCIPAL stands in for T-020's session.
    // The rest is the reference the first production reveal action copies. No revalidatePath: a
    // reveal writes only an audit row, and no screen renders audit rows.
    const parsed = revealSensitiveFieldInputSchema.safeParse({
      caregiverId: formData.get('caregiverId'),
      field: formData.get('field'),
      reason: formData.get('reason'),
    })
    if (!parsed.success) {
      return { status: 'invalid', message: 'Enter the reason you need to see this value.' }
    }
    return runAsPrincipal(PROBE_PRINCIPAL, {}, () => revealSensitiveField(parsed.data))
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Dev tools</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-muted">Connection</h2>
        <p className="font-mono text-sm">{snapshot.connection}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-muted">Applied migrations</h2>
        <ul className="font-mono text-sm">
          {snapshot.appliedMigrations.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        {/* Row counts only. A row in eeoc or medical is restricted data; a count of them is not. */}
        <h2 className="text-sm font-medium text-ink-muted">Tables</h2>
        <ul className="font-mono text-sm">
          {snapshot.tables.map((table) => (
            <li key={`${table.schema}.${table.table}`}>
              {table.schema}.{table.table}: {table.rows}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-muted">Audit-context probe</h2>
        <ul className="font-mono text-sm">
          {lastProbe.map((seam) => (
            <li key={seam.name}>
              {seam.pass ? 'PASS' : 'FAIL'} — {seam.name}
            </li>
          ))}
        </ul>
        <form action={runAuditProbe}>
          <button type="submit" className="min-h-11 rounded-md border border-border px-4 text-sm font-medium">
            Run audit-context probe
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-muted">Sensitive field reveal</h2>
        <Sensitive
          caregiverId="dev-probe-caregiver"
          field="ssn"
          last4="6789"
          label="Social Security number"
          reveal={revealDevSsn}
        />
      </section>

      <form action={reset}>
        <button type="submit" className="min-h-11 rounded-md border border-border px-4 text-sm font-medium">
          Reset database
        </button>
      </form>
    </main>
  )
}
