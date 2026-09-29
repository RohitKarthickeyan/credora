import type { Address, UsState } from '@/domain/validation/address'
import { addressSchema } from '@/domain/validation/address'

/**
 * One mapping for both `ContactRecord` and `EmploymentEntry`: T-010 copied the five column
 * names verbatim from `Address`, so this is a projection with no renaming at all.
 */

/** The five embedded columns, as they exist on ContactRecord and on EmploymentEntry. */
type AddressColumns = {
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

/** An address captured only in part — every field named, every field nullable. */
export type PartialAddress = {
  line1: string | null
  line2: string | null
  city: string | null
  state: UsState | null
  zip: string | null
}

/** What the five columns actually hold. Three states, because they are three facts. */
export type StoredAddress =
  | { readonly status: 'absent' }
  | { readonly status: 'partial'; readonly columns: AddressColumns }
  | { readonly status: 'complete'; readonly address: Address }

/** `null` clears the address — five columns, one call, no hand-written nulls at a call site. */
export function toAddressColumns(address: Address | null): AddressColumns {
  if (address === null) {
    return { line1: null, line2: null, city: null, state: null, zip: null }
  }

  return {
    line1: address.line1,
    // `addressSchema` produces `undefined` for an untouched optional field; a nullable column
    // takes `null`. That translation is the whole reason this is a function and not a spread.
    line2: address.line2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
  }
}

/**
 * A half-answered address is a legitimate mid-intake state and an employer address is routinely
 * city-and-state only. All five keys are required so a caller cannot drop one by omission or
 * transpose `city` and `state` — the failure mode the column naming was chosen to prevent.
 */
export function toPartialAddressColumns(address: PartialAddress): AddressColumns {
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    zip: address.zip,
  }
}

/**
 * Never fabricates and never discards. `'partial'` also covers present-but-invalid — five
 * non-null columns whose `state` is `New York` — because a bad value in a column is a
 * data-quality problem for the caller to surface, not a crash on read.
 */
export function fromAddressColumns(row: AddressColumns): StoredAddress {
  // Narrowed rather than passed through: a caller hands this a whole Prisma row, and the
  // `partial` branch must carry the five address columns, not the other twenty.
  const { line1, line2, city, state, zip } = row
  const columns: AddressColumns = { line1, line2, city, state, zip }

  if (line1 === null && line2 === null && city === null && state === null && zip === null) {
    return { status: 'absent' }
  }

  const parsed = addressSchema.safeParse({ ...columns, line2: line2 ?? undefined })

  return parsed.success
    ? { status: 'complete', address: parsed.data }
    : { status: 'partial', columns }
}
