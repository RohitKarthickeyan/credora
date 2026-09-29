import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'

// Envelope: version(1) ‖ keyId(4) ‖ nonce(12) ‖ authTag(16) ‖ ciphertext.
// Every fixed-width field sits in the 33-byte prefix, so decryption validates one length and
// then reads constant slices.
const VERSION = 0x01
const KEY_ID_BYTES = 4
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 1 + KEY_ID_BYTES
const PREFIX_BYTES = HEADER_BYTES + NONCE_BYTES + TAG_BYTES
// An empty plaintext is never sealed, so a valid envelope carries at least one ciphertext byte.
const MIN_ENVELOPE_BYTES = PREFIX_BYTES + 1

const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64')
// Derived, not configured: a key id that is a property of the key cannot desynchronise from it.
const KEY_ID = createHash('sha256').update(KEY).digest().subarray(0, KEY_ID_BYTES)
const KEYRING = new Map<string, Buffer>([[KEY_ID.toString('hex'), KEY]])

/**
 * Seal a canonical field value for a `*Enc Bytes?` column. `null` in, `null` out — an absent
 * value stays absent rather than becoming an encrypted empty string.
 *
 * The `ArrayBuffer` argument is load-bearing: Prisma types a `Bytes` input as
 * `Uint8Array<ArrayBuffer>`, and a bare `Buffer` is `Buffer<ArrayBufferLike>`, which does not
 * assign to it. `Buffer.concat` already returns `Buffer<ArrayBuffer>`.
 */
export function encryptField(plaintext: string | null): Buffer<ArrayBuffer> | null {
  if (plaintext === null) return null
  if (plaintext === '') throw new Error('An empty value is stored as null, not as ciphertext.')

  // version ‖ keyId is the AAD: without it the header is unauthenticated and a writer could
  // flip the version or the key id to steer parsing. The nonce is already a GCM input.
  const header = Buffer.concat([Buffer.of(VERSION), KEY_ID])
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', KEY, nonce)
  cipher.setAAD(header)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext])
}

/**
 * Open a `*Enc` column value. `null` in, `null` out. Throws on any damaged, forged, or
 * unreadable envelope: a field that cannot be decrypted means tampering, corruption or a wrong
 * key, and there is no branch a caller could usefully take.
 */
export function decryptField(envelope: Uint8Array | null): string | null {
  if (envelope === null) return null

  // Prisma 7 hands back a plain Uint8Array, not a Buffer (ADR-009).
  const bytes = Buffer.from(envelope)

  if (bytes.byteLength < MIN_ENVELOPE_BYTES) {
    throw new Error(`Encrypted field envelope is too short: ${bytes.byteLength} bytes.`)
  }

  const version = bytes.readUInt8(0)
  if (version !== VERSION) {
    throw new Error(`Unknown encrypted field envelope version: ${version}.`)
  }

  const keyId = bytes.subarray(1, HEADER_BYTES).toString('hex')
  const key = KEYRING.get(keyId)
  if (key === undefined) {
    throw new Error(`No key is configured for encrypted-field key id ${keyId}.`)
  }

  const nonce = bytes.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(bytes.subarray(0, HEADER_BYTES))
  decipher.setAuthTag(bytes.subarray(HEADER_BYTES + NONCE_BYTES, PREFIX_BYTES))

  const ciphertext = bytes.subarray(PREFIX_BYTES)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Seal a value whose model also carries a plaintext `*Last4` display column. The only way to
 * obtain a stored last-4, so a call site cannot label a value without sealing it.
 */
export function encryptFieldWithLast4(plaintext: string | null): {
  enc: Buffer<ArrayBuffer> | null
  last4: string | null
} {
  if (plaintext === null) return { enc: null, last4: null }

  return { enc: encryptField(plaintext), last4: plaintext.slice(-4) }
}
