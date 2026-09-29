// Crockford base32: no I, L, O or U, so a hand-copied key cannot be misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const MAX_TIMESTAMP = 2 ** 48
const ENTROPY_BYTES = 10
const ULID_LENGTH = 26

// tsconfig targets ES2017, where BigInt *literals* are a syntax error, so the constants are
// built by call. The arithmetic is the plain one: 8 bits per entropy byte, 5 per base32 symbol.
const BITS_PER_BYTE = BigInt(8)
const BITS_PER_SYMBOL = BigInt(5)
const SYMBOL_MASK = BigInt(31)

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * 48 bits of Unix milliseconds in the first ten characters, 80 bits of randomness in the last
 * sixteen — so ULIDs sort lexicographically in creation order. Both parameters are defaulted
 * rather than read inside so the encoding can be pinned by exact-output tests.
 */
export function ulid(
  now: number = Date.now(),
  entropy: Uint8Array = crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES)),
): string {
  if (!Number.isInteger(now) || now < 0 || now >= MAX_TIMESTAMP) {
    throw new Error(`ulid: timestamp must be an integer in [0, 2**48), received ${now}.`)
  }
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`ulid: entropy must be ${ENTROPY_BYTES} bytes, received ${entropy.length}.`)
  }

  let value = BigInt(now)
  for (const byte of entropy) value = (value << BITS_PER_BYTE) | BigInt(byte)

  const characters = new Array<string>(ULID_LENGTH)
  for (let index = ULID_LENGTH - 1; index >= 0; index -= 1) {
    characters[index] = ALPHABET.charAt(Number(value & SYMBOL_MASK))
    value >>= BITS_PER_SYMBOL
  }
  return characters.join('')
}
