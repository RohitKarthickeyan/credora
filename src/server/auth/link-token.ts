import 'server-only'
import type { AuditedTx } from '@/db/audit'
import { runInAuditedTransaction } from '@/db/audit'
import { consumeLinkToken, findLiveLinkToken } from '@/db/repositories/link-tokens'
import type { LinkGrantFor, LinkOutcome, LinkTokenPurpose } from '@/domain/auth/link-token'
import { runAsSystem } from './context'

export type LinkUseCase<I, O> = ((token: string, input: I) => Promise<LinkOutcome<O>>) & {
  readonly linkPurpose: LinkTokenPurpose
}

/**
 * The only way to write an action taken by a person holding a link rather than a login
 * (ADR-027). The token is the authorization: a capability for one purpose on one subject.
 *
 * `runAsSystem` clears any principal, so a staff session in the same browser lends the token
 * holder nothing, and a guarded use case called from `run` throws. `run` shares the
 * transaction the token is consumed in, so if it throws the link stays usable. An `'inspect'`
 * use case only looks the token up, for a GET — link-preview prefetch must not burn it.
 *
 * `run` must pass `grant.agencyId` to every repository it calls: this is not an agency check.
 */
export function defineLinkUseCase<P extends LinkTokenPurpose, I, O>(
  purpose: P,
  mode: 'inspect' | 'consume',
  run: (context: {
    readonly grant: LinkGrantFor<P>
    readonly input: I
    readonly tx: AuditedTx
  }) => Promise<O>,
): LinkUseCase<I, O> {
  const useCase = (token: string, input: I): Promise<LinkOutcome<O>> =>
    runAsSystem(() =>
      runInAuditedTransaction(async (tx) => {
        const now = new Date()
        const lookup =
          mode === 'consume'
            ? await consumeLinkToken(tx, token, purpose, now)
            : await findLiveLinkToken(token, purpose, now)
        if (!lookup.ok) return lookup

        // The repository refuses a token of any other purpose, so the grant is this purpose's.
        const grant = lookup.grant as LinkGrantFor<P>
        return { ok: true, value: await run({ grant, input, tx }) }
      }),
    )

  return Object.defineProperty(useCase, 'linkPurpose', {
    value: purpose,
    enumerable: false,
  }) as LinkUseCase<I, O>
}
