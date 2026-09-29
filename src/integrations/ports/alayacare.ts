import { z } from 'zod'
import { storageKeySchema } from './storage'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

export type FieldConflict = {
  readonly field: string
  readonly ours: string
  readonly theirs: string
}

// `conflict` exists because an existing profile with a different DOB is surfaced, never
// overwritten (INTEGRATIONS.md § The AlayaCare mock deserves its own note).
export type SyncOutcome<T> =
  | { readonly status: 'applied'; readonly value: T }
  | { readonly status: 'conflict'; readonly conflicts: readonly FieldConflict[] }
  | { readonly status: 'rejected'; readonly reason: string }

const alayaCareProfileSchema = z.object({
  externalId: z.string().min(1).nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.iso.date(),
  email: z.email().nullable(),
  phone: z.string().min(1).nullable(),
  startDate: z.iso.date().nullable(),
})
export type AlayaCareProfile = z.infer<typeof alayaCareProfileSchema>

export const findProfileInputSchema = z.object({
  agencyId: z.uuid(),
  lookup: z.discriminatedUnion('by', [
    z.object({ by: z.literal('externalId'), externalId: z.string().min(1) }),
    z.object({
      by: z.literal('identity'),
      lastName: z.string().min(1),
      dateOfBirth: z.iso.date(),
    }),
  ]),
})
export type FindProfileInput = z.infer<typeof findProfileInputSchema>

export const upsertProfileInputSchema = z.object({
  agencyId: z.uuid(),
  caregiverId: z.uuid(),
  profile: alayaCareProfileSchema,
  idempotencyKey: z.string().min(1),
})
type UpsertProfileInput = z.infer<typeof upsertProfileInputSchema>

export const alayaCareCredentialSchema = z.object({
  code: z.string().min(1),
  number: z.string().min(1).nullable(),
  issuer: z.string().min(1).nullable(),
  issuedOn: z.iso.date().nullable(),
  expiresOn: z.iso.date().nullable(),
  documentKey: storageKeySchema.nullable(),
})
export type AlayaCareCredential = z.infer<typeof alayaCareCredentialSchema>

export const writeCredentialInputSchema = z.object({
  agencyId: z.uuid(),
  externalId: z.string().min(1),
  credential: alayaCareCredentialSchema,
  idempotencyKey: z.string().min(1),
})
export type WriteCredentialInput = z.infer<typeof writeCredentialInputSchema>

// Custom fields sit behind a separate AlayaCare endpoint with a different shape.
export const writeCustomFieldsInputSchema = z.object({
  agencyId: z.uuid(),
  externalId: z.string().min(1),
  fields: z.record(z.string().min(1), z.string()),
  idempotencyKey: z.string().min(1),
})
export type WriteCustomFieldsInput = z.infer<typeof writeCustomFieldsInputSchema>

export const uploadDocumentInputSchema = z.object({
  agencyId: z.uuid(),
  externalId: z.string().min(1),
  storageKey: storageKeySchema,
  filename: z.string().min(1),
  idempotencyKey: z.string().min(1),
})
export type UploadDocumentInput = z.infer<typeof uploadDocumentInputSchema>

export interface AlayaCarePort {
  findProfile(input: FindProfileInput): Promise<AlayaCareProfile | null>
  upsertProfile(input: UpsertProfileInput): Promise<SyncOutcome<{ readonly externalId: string }>>
  // A credential write can succeed and return no id — the case that forces real idempotency
  // keys — so the success arm allows null.
  writeCredential(
    input: WriteCredentialInput,
  ): Promise<SyncOutcome<{ readonly credentialId: string | null }>>
  writeCustomFields(input: WriteCustomFieldsInput): Promise<SyncOutcome<null>>
  uploadDocument(input: UploadDocumentInput): Promise<SyncOutcome<{ readonly documentId: string }>>
}
