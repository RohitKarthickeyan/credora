import { encryptField, encryptFieldWithLast4 } from '@/db/crypto'

/**
 * The four ciphertext columns. `ssnLast4` and `bankAccountLast4` are plaintext display columns
 * and are deliberately not here — they belong in every select.
 */
export const ENCRYPTED_COLUMNS = [
  'bankAccountNumberEnc',
  'bankRoutingNumberEnc',
  'ssnEnc',
  'workAuthorizationNumberEnc',
] as const

export type EncryptedColumn = (typeof ENCRYPTED_COLUMNS)[number]

/** A row shape that provably carries no ciphertext: the envelope columns must be absent. */
export type WithoutEnvelopes<T> = T & { readonly [K in EncryptedColumn]?: never }

/** A select that omits every envelope column and no other column. */
export type SealedSelect<TSelectScalar> = Required<Omit<TSelectScalar, EncryptedColumn>> & {
  [K in EncryptedColumn]?: never
}

/**
 * One function per column group, not one per model: an update that changes only the SSN spreads
 * only this group and omits the rest from the Prisma payload, so it never has to supply a
 * plaintext it does not hold. Every parameter is `string | null` — `undefined` would turn
 * "leave this column alone" into "set this column to NULL" (T-012 § Design 3(b)).
 *
 * There is no read function here, and that is the point: this module never decrypts. The
 * ordinary read path selects the `*Last4` column and leaves the envelope sealed; the one reveal
 * door is `revealSensitiveField`, inside the audit transaction (SECURITY.md § Field masking).
 */

/** Both SSN columns from one call, so the ciphertext and its label cannot be written apart. */
export function toSsnColumns(ssn: string | null): {
  ssnEnc: Buffer<ArrayBuffer> | null
  ssnLast4: string | null
} {
  const { enc, last4 } = encryptFieldWithLast4(ssn)

  return { ssnEnc: enc, ssnLast4: last4 }
}

export function toBankAccountNumberColumns(accountNumber: string | null): {
  bankAccountNumberEnc: Buffer<ArrayBuffer> | null
  bankAccountLast4: string | null
} {
  const { enc, last4 } = encryptFieldWithLast4(accountNumber)

  return { bankAccountNumberEnc: enc, bankAccountLast4: last4 }
}

/**
 * The single-key returns buy the one thing that matters: the column name is spelled in exactly
 * one file, so a call site spreads the result and never types it.
 */
export function toBankRoutingNumberColumns(routingNumber: string | null): {
  bankRoutingNumberEnc: Buffer<ArrayBuffer> | null
} {
  return { bankRoutingNumberEnc: encryptField(routingNumber) }
}

export function toWorkAuthorizationNumberColumns(documentNumber: string | null): {
  workAuthorizationNumberEnc: Buffer<ArrayBuffer> | null
} {
  return { workAuthorizationNumberEnc: encryptField(documentNumber) }
}
