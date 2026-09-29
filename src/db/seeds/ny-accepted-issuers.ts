import type { AcceptedIssuerKind } from '@/domain/documents/accepted-issuer'
import type { CorePrismaClient } from '../prisma'

// Only `import type` lines and the client as a parameter: `tsx prisma/seed.ts` (T-132) must load
// this module without the app's path aliases.

// No named training school or clinic is invented here: a real-looking made-up entry would let
// documents skip the judge's issuer check. The agency's own programs and clinics are entered
// through the admin page (T-077 Flag 1).
const NY_ACCEPTED_ISSUERS: ReadonlyArray<{
  readonly name: string
  readonly kind: AcceptedIssuerKind
}> = [
  { name: 'New York State Department of Health', kind: 'STATE_AGENCY' },
  { name: 'American Heart Association', kind: 'TRAINING_PROGRAM' },
  { name: 'American Red Cross', kind: 'TRAINING_PROGRAM' },
]

// Copied into one agency, not shared: the list is agency-maintained. Writes no audit entry, as
// the factories do not, because a seed runs outside any request.
export async function seedNyAcceptedIssuers(
  db: CorePrismaClient,
  agencyId: string,
): Promise<number> {
  const live = await db.acceptedIssuer.findMany({
    where: { agencyId, retiredAt: null },
    select: { name: true },
  })
  const existing = new Set(live.map((row) => row.name))
  const missing = NY_ACCEPTED_ISSUERS.filter((issuer) => !existing.has(issuer.name))

  const { count } = await db.acceptedIssuer.createMany({
    data: missing.map((issuer) => ({ agencyId, name: issuer.name, kind: issuer.kind })),
  })
  return count
}
