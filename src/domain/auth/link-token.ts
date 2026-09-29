import { z } from 'zod'

// The source of truth for link purposes. The Prisma enum `LinkTokenPurpose` mirrors this list,
// because src/domain may not import src/db (ARCHITECTURE.md § Layers); keep the two in step.
export const LINK_TOKEN_PURPOSES = ['INVITE', 'REFERENCE_FORM', 'STAFF_INVITE'] as const

export type LinkTokenPurpose = (typeof LINK_TOKEN_PURPOSES)[number]

// Product-owner default in force (T-022 § Risks 2). The invite TTL also moves the retention
// clock: SECURITY.md § Retention deletes never-started applicants 30 days after invite expiry.
export const LINK_TOKEN_TTL_DAYS: Readonly<Record<LinkTokenPurpose, number>> = {
  INVITE: 7,
  REFERENCE_FORM: 14,
  STAFF_INVITE: 7,
}

// 32 random bytes, base64url without padding.
export const linkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/**
 * What a live token entitles its holder to: one purpose on one subject in one agency. The token
 * holder's analogue of a `Principal`, and like it, `agencyId` is the tenant for every read the
 * holder's action performs.
 */
export type LinkGrant =
  | {
      readonly purpose: 'INVITE'
      readonly tokenId: string
      readonly agencyId: string
      readonly caregiverId: string
    }
  | {
      readonly purpose: 'REFERENCE_FORM'
      readonly tokenId: string
      readonly agencyId: string
      readonly caregiverId: string
      readonly referenceId: string
    }
  | {
      readonly purpose: 'STAFF_INVITE'
      readonly tokenId: string
      readonly agencyId: string
      readonly userId: string
    }

export type LinkGrantFor<P extends LinkTokenPurpose> = Extract<LinkGrant, { purpose: P }>

export type LinkRefusal = 'INVALID' | 'EXPIRED' | 'USED'

export type LinkLookup =
  | { readonly ok: true; readonly grant: LinkGrant }
  | { readonly ok: false; readonly refusal: LinkRefusal }

export type LinkOutcome<O> =
  { readonly ok: true; readonly value: O } | { readonly ok: false; readonly refusal: LinkRefusal }
