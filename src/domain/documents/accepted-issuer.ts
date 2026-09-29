import { z } from 'zod'

// The source of truth for the Prisma enum AcceptedIssuerKind, which mirrors it because
// src/domain may not import src/db; keep the two in step. The three
// values are the PRD's "a recognized training program, licensed clinic, or state agency".
export const ACCEPTED_ISSUER_KINDS = ['TRAINING_PROGRAM', 'CLINIC', 'STATE_AGENCY'] as const
export type AcceptedIssuerKind = (typeof ACCEPTED_ISSUER_KINDS)[number]

export type AcceptedIssuer = {
  readonly id: string
  readonly name: string
  readonly kind: AcceptedIssuerKind
}

export type AcceptedIssuerWriteResult =
  | { readonly ok: true; readonly issuer: AcceptedIssuer }
  | { readonly ok: false; readonly reason: 'DUPLICATE_NAME' | 'NOT_FOUND' }

// Deliberately narrow: a match skips the judge's issuer check (AGENTIC-TASKS.md § Permitted 1),
// so only differences that are certainly the same name are absorbed. No suffix stripping, no
// abbreviations, no stop-words.
function normalizeIssuerName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Equality only. A substring, prefix or fuzzy match would let "Acme Home Care Fraud Clinic"
// through as "Acme Home Care", and a false hit is the unsafe direction.
export function matchAcceptedIssuer(
  issuerText: string,
  issuers: readonly AcceptedIssuer[],
): AcceptedIssuer | null {
  const wanted = normalizeIssuerName(issuerText)
  if (wanted === '') return null
  return issuers.find((issuer) => normalizeIssuerName(issuer.name) === wanted) ?? null
}

export const acceptedIssuerInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => normalizeIssuerName(name) !== '', {
      error: 'A name made only of punctuation could never match a document.',
    }),
  kind: z.enum(ACCEPTED_ISSUER_KINDS),
})

export type AcceptedIssuerInput = z.infer<typeof acceptedIssuerInputSchema>
