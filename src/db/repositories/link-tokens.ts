import { createHash, randomBytes } from 'node:crypto'
import type { LinkGrant, LinkLookup, LinkTokenPurpose } from '@/domain/auth/link-token'
import { LINK_TOKEN_TTL_DAYS, linkTokenSchema } from '@/domain/auth/link-token'
import type { AuditedTx } from '../audit'
import type { LinkTokenModel } from '../generated/models/LinkToken'
import { prisma } from '../prisma'

const DAY_MS = 86_400_000

type IssueLinkTokenInput =
  | {
      readonly purpose: 'INVITE'
      readonly caregiverId: string
      readonly now: Date
    }
  | {
      readonly purpose: 'REFERENCE_FORM'
      readonly caregiverId: string
      readonly referenceId: string
      readonly now: Date
    }
  | {
      readonly purpose: 'STAFF_INVITE'
      readonly userId: string
      readonly now: Date
    }

export type IssuedLinkToken = {
  readonly id: string
  readonly token: string
  readonly expiresAt: Date
}

function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Mint a link for one subject and expire any live link already sent for it, so at most one link
 * per subject works: re-sending to a corrected address kills the one emailed to the wrong one.
 * The raw token is returned once, for the caller's URL, and is stored nowhere. It takes an
 * `AuditedTx` so the token commits or rolls back with the caller's own write.
 */
export async function issueLinkToken(
  tx: AuditedTx,
  agencyId: string,
  input: IssueLinkTokenInput,
): Promise<IssuedLinkToken> {
  const subjectId =
    input.purpose === 'REFERENCE_FORM'
      ? input.referenceId
      : input.purpose === 'STAFF_INVITE'
        ? input.userId
        : input.caregiverId
  const caregiverId = input.purpose === 'STAFF_INVITE' ? null : input.caregiverId

  await tx.linkToken.updateMany({
    where: {
      agencyId,
      purpose: input.purpose,
      subjectId,
      consumedAt: null,
      expiresAt: { gt: input.now },
    },
    data: { expiresAt: input.now },
  })

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(input.now.getTime() + LINK_TOKEN_TTL_DAYS[input.purpose] * DAY_MS)

  const { id } = await tx.linkToken.create({
    data: {
      agencyId,
      caregiverId,
      purpose: input.purpose,
      subjectId,
      tokenHash: hashLinkToken(token),
      expiresAt,
    },
    select: { id: true },
  })

  return { id, token, expiresAt }
}

function grantOf(row: LinkTokenModel): LinkGrant {
  if (row.purpose === 'STAFF_INVITE') {
    return { purpose: 'STAFF_INVITE', tokenId: row.id, agencyId: row.agencyId, userId: row.subjectId }
  }
  if (row.caregiverId === null) {
    throw new Error(`Link token ${row.id} is a ${row.purpose} token with no caregiver.`)
  }
  const common = {
    tokenId: row.id,
    agencyId: row.agencyId,
    caregiverId: row.caregiverId,
  }
  switch (row.purpose) {
    case 'INVITE':
      return { purpose: 'INVITE', ...common }
    case 'REFERENCE_FORM':
      return { purpose: 'REFERENCE_FORM', ...common, referenceId: row.subjectId }
  }
}

// A wrong-purpose token is INVALID rather than USED or EXPIRED, so an invite token reveals
// nothing about a reference form.
function lookupOf(row: LinkTokenModel | null, purpose: LinkTokenPurpose, now: Date): LinkLookup {
  if (row === null || row.purpose !== purpose) return { ok: false, refusal: 'INVALID' }
  if (row.consumedAt !== null) return { ok: false, refusal: 'USED' }
  if (row.expiresAt <= now) return { ok: false, refusal: 'EXPIRED' }
  return { ok: true, grant: grantOf(row) }
}

/**
 * The live grant a token carries, without using it up — for rendering a page on GET. Consuming
 * here would be wrong: mail clients prefetch links for previews.
 *
 * A declared exception to DATA-MODEL.md invariant 5: there is no `agencyId` parameter because
 * the token is what resolves the tenant, as `User.email` does for staff and as `claimJobs` reads
 * across tenants. The key is a 256-bit hash, so it cannot range over another tenant's rows, and
 * the grant carries the `agencyId` every later read must pass.
 */
export async function findLiveLinkToken(
  token: string,
  purpose: LinkTokenPurpose,
  now: Date,
): Promise<LinkLookup> {
  if (!linkTokenSchema.safeParse(token).success) return { ok: false, refusal: 'INVALID' }

  const row = await prisma.linkToken.findUnique({
    where: { tokenHash: hashLinkToken(token) },
  })
  return lookupOf(row, purpose, now)
}

/**
 * Use a token up. The conditional update is the single-use guarantee: under READ COMMITTED a
 * concurrent second consumer blocks on the row lock and re-evaluates the predicate after the
 * first commits, so exactly one succeeds — and if the first rolls back, the second succeeds, so
 * a failed submission leaves the link usable.
 *
 * The same declared exception to invariant 5 as `findLiveLinkToken`: the token resolves the
 * tenant, and the grant carries the `agencyId` every later read must pass.
 */
export async function consumeLinkToken(
  tx: AuditedTx,
  token: string,
  purpose: LinkTokenPurpose,
  now: Date,
): Promise<LinkLookup> {
  if (!linkTokenSchema.safeParse(token).success) return { ok: false, refusal: 'INVALID' }

  const tokenHash = hashLinkToken(token)
  const consumed = await tx.linkToken.updateMany({
    where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  })

  const row = await tx.linkToken.findUnique({ where: { tokenHash } })
  if (consumed.count === 1 && row !== null) return { ok: true, grant: grantOf(row) }
  return lookupOf(row, purpose, now)
}
