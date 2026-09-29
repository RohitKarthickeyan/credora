import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 6238 with the parameters every authenticator app defaults to: HMAC-SHA1, 6 digits, 30 s.
const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(text: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text) {
    value = (value << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS)
}

function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  // RFC 4226 § 5.3 dynamic truncation.
  const offset = (hmac[hmac.length - 1] ?? 0) & 15
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/** The step whose code matches, allowing one step of clock drift either way; else null. */
export function matchTotp(secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const actual = Buffer.from(code)
  const current = totpStep(now)
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), actual)) return step
  }
  return null
}

export function totpUri({
  accountName,
  secret,
}: {
  readonly accountName: string
  readonly secret: string
}): string {
  return `otpauth://totp/Credora:${encodeURIComponent(accountName)}?secret=${secret}&issuer=Credora&algorithm=SHA1&digits=6&period=30`
}
