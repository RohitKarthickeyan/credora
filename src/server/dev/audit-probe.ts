import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { requirePrincipal } from '../auth/context'
import { defineUseCase } from '../auth/policy'

export type ProbeSeam = { readonly name: string; readonly pass: boolean }

type ProbeInput = { readonly caregiverId: string }

async function principalSurvivesAwaits(id: string): Promise<boolean> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  return requirePrincipal().id === id
}

/**
 * Whether the principal and audit context established at a Next boundary are still readable from
 * the code that boundary calls. `AsyncLocalStorage` propagates per continuation, and a Server
 * Action is dispatched by Next's own ALS-based machinery, so the claim the whole authorization
 * design rests on is checked against a real dispatch rather than assumed. Permanent, not
 * scaffolding: `next.config.ts` keeps this page out of the production build, so the next Next
 * upgrade can re-run it for nothing.
 *
 * The fourth seam — after `revalidatePath` — belongs to the action, because that is where the
 * call lives. The three below are the ones inside the use case.
 */
export const auditProbe = defineUseCase<'caregiver.view', ProbeInput, readonly ProbeSeam[]>(
  'caregiver.view',
  async ({ principal, input }) => {
    const afterAwaits = await principalSurvivesAwaits(principal.id)

    const [left, right] = await Promise.all([
      principalSurvivesAwaits(principal.id),
      principalSurvivesAwaits(principal.id),
    ])

    const insideTransaction = await runInAuditedTransaction(async (tx) => {
      const held = requirePrincipal().id === principal.id
      // The observable result of the whole probe: writeAuditEntry reads the actor from the
      // ambient context and would throw without it, so a committed row is the proof.
      await writeAuditEntry(tx, {
        agencyId: principal.agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: input.caregiverId,
      })
      return held
    })

    return [
      { name: 'Server Action body → awaited call chain', pass: afterAwaits },
      { name: 'Promise.all fan-out', pass: left && right },
      { name: 'runInAuditedTransaction callback → committed row', pass: insideTransaction },
    ]
  },
)
