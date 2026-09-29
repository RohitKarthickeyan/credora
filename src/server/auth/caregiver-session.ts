import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { cache } from 'react'
import { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { findCaregiverForSession, findCaregiversByEmail } from '@/db/repositories/caregiver-sign-in'
import {
  consumeOneTimeCode,
  countOneTimeCodesSince,
  createOneTimeCode,
  expireOneTimeCode,
  recordOneTimeCodeAttempt,
} from '@/db/repositories/one-time-codes'
import type { CaregiverPrincipal } from '@/domain/auth/caregiver-principal'
import { caregiverPrincipalFrom } from '@/domain/auth/caregiver-principal'
import {
  ONE_TIME_CODE_MAX_ATTEMPTS,
  ONE_TIME_CODE_TTL_MS,
  ONE_TIME_CODES_PER_HOUR,
  oneTimeCodeRefusal,
} from '@/domain/auth/one-time-code'
import type { MessagingPort } from '@/integrations/ports/messaging'
import { buildIdempotencyKey } from '@/integrations/queue/idempotency'
import { env } from '@/lib/env'
import { generateOneTimeCode, hashOneTimeCode, oneTimeCodeMatches } from '@/lib/otp'
import { runAsSystem } from './context'

const SESSION_COOKIE = 'credora_caregiver_session'
const CODE_COOKIE = 'credora_caregiver_code'

// The audience is what stops a staff token (which has none) verifying here; the staff claims
// schema is strict, so a caregiver token fails there.
const SESSION_AUDIENCE = 'credora:caregiver'
const CODE_AUDIENCE = 'credora:caregiver-code'

// Absolute, no sliding refresh: a product-owner default (ADR-059).
const CAREGIVER_SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000

const key = new TextEncoder().encode(env.SESSION_SECRET)
// The pending-code cookie is issued for every address, so it is encrypted: a readable agency id
// would repeat across probes of a registered address and tell it from a decoy (ADR-061).
const codeKey = createHmac('sha256', env.SESSION_SECRET)
  .update('credora.caregiver-code-cookie')
  .digest()

const claimsSchema = z.strictObject({
  sub: z.string().min(1),
  agencyId: z.string().min(1),
  aud: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
})

type Claims = z.infer<typeof claimsSchema>

type CookieClaims = { readonly sub: string; readonly agencyId: string }

async function setCookie(name: string, token: string, path: string, expires: Date): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(name, token, { httpOnly: true, secure: true, sameSite: 'lax', path, expires })
}

async function setSessionCookie(claims: CookieClaims, issuedAt: Date): Promise<void> {
  const expiresAt = new Date(issuedAt.getTime() + CAREGIVER_SESSION_LIFETIME_MS)
  const token = await new SignJWT({ agencyId: claims.agencyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key)
  await setCookie(SESSION_COOKIE, token, '/', expiresAt)
}

async function readSessionCookie(): Promise<Claims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token === undefined) return null

  // Pinning the algorithm refuses `alg: none` and algorithm confusion; a bad or expired token is
  // an expected outcome, not an error.
  const verified = await jwtVerify(token, key, {
    algorithms: ['HS256'],
    audience: SESSION_AUDIENCE,
  }).catch(() => null)
  const claims = claimsSchema.safeParse(verified?.payload)
  return claims.success ? claims.data : null
}

async function setCodeCookie(claims: CookieClaims, issuedAt: Date): Promise<void> {
  const expiresAt = new Date(issuedAt.getTime() + ONE_TIME_CODE_TTL_MS)
  const token = await new EncryptJWT({ agencyId: claims.agencyId })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setSubject(claims.sub)
    .setAudience(CODE_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .encrypt(codeKey)
  await setCookie(CODE_COOKIE, token, '/verify', expiresAt)
}

async function readCodeCookie(): Promise<Claims | null> {
  const token = (await cookies()).get(CODE_COOKIE)?.value
  if (token === undefined) return null

  const decrypted = await jwtDecrypt(token, codeKey, {
    audience: CODE_AUDIENCE,
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
  }).catch(() => null)
  const claims = claimsSchema.safeParse(decrypted?.payload)
  return claims.success ? claims.data : null
}

async function deleteCodeCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete({ name: CODE_COOKIE, path: '/verify' })
}

/**
 * Email a sign-in code to the caregiver holding `email`. Only the email lookup runs before the
 * response, and every address gets a pending-code cookie of the same shape, so an unknown,
 * withdrawn, shared or rate-limited address is indistinguishable from one that got a code. The
 * code is created and emailed after the response (ADR-061).
 */
export async function requestCaregiverCode(
  input: { readonly email: string },
  messaging: MessagingPort,
): Promise<void> {
  const now = new Date()
  const matches = await findCaregiversByEmail(input.email)
  const [match] = matches
  const codeId = randomUUID()

  if (matches.length !== 1 || match === undefined) {
    await setCodeCookie({ sub: codeId, agencyId: randomUUID() }, now)
    return
  }

  const { agencyId, caregiverId } = match
  await setCodeCookie({ sub: codeId, agencyId }, now)
  after(() =>
    sendCaregiverCode({ agencyId, caregiverId, codeId, email: input.email, now }, messaging),
  )
}

// The send follows the commit and is not queued (ADR-057): only the code's hash is stored.
async function sendCaregiverCode(
  input: {
    readonly agencyId: string
    readonly caregiverId: string
    readonly codeId: string
    readonly email: string
    readonly now: Date
  },
  messaging: MessagingPort,
): Promise<void> {
  const { agencyId, caregiverId, codeId, now } = input
  const code = await runAsSystem(() =>
    runInAuditedTransaction(async (tx) => {
      const recent = await countOneTimeCodesSince(
        tx,
        agencyId,
        caregiverId,
        new Date(now.getTime() - HOUR_MS),
      )
      if (recent >= ONE_TIME_CODES_PER_HOUR) return null

      const generated = generateOneTimeCode()
      await createOneTimeCode(tx, agencyId, {
        id: codeId,
        caregiverId,
        codeHash: hashOneTimeCode(caregiverId, generated),
        now,
      })
      return generated
    }),
  )
  if (code === null) return

  const result = await messaging.send({
    agencyId,
    to: input.email,
    subject: 'Your Credora sign-in code',
    body: `Your Credora sign-in code is ${code}. It expires in 10 minutes.`,
    idempotencyKey: buildIdempotencyKey('caregiver.oneTimeCode', [codeId]),
  })

  if (result.status === 'rejected') {
    await expireOneTimeCode(agencyId, codeId, new Date())
  }
}

// The refusal kind is for tests of the ADR-059 limits; the UI shows one copy for all of them.
export type CaregiverCodeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: 'NO_CODE' | 'WRONG_CODE' | 'USED' | 'EXPIRED' | 'LOCKED' }

/** Check a typed code against the one the pending-code cookie names; on success, sign in. */
export async function verifyCaregiverCode(code: string): Promise<CaregiverCodeResult> {
  const pending = await readCodeCookie()
  if (pending === null) return { ok: false, refusal: 'NO_CODE' }

  const now = new Date()
  const attempt = await recordOneTimeCodeAttempt(pending.agencyId, pending.sub, now)
  const row = attempt.code
  if (row === null) return { ok: false, refusal: 'NO_CODE' }

  if (!attempt.counted) {
    return { ok: false, refusal: oneTimeCodeRefusal(row, now) ?? 'NO_CODE' }
  }

  if (!oneTimeCodeMatches(row.codeHash, row.caregiverId, code)) {
    return {
      ok: false,
      refusal: row.attempts >= ONE_TIME_CODE_MAX_ATTEMPTS ? 'LOCKED' : 'WRONG_CODE',
    }
  }

  if (!(await consumeOneTimeCode(pending.agencyId, row.id, now))) {
    return { ok: false, refusal: 'USED' }
  }

  const caregiver = await findCaregiverForSession(pending.agencyId, row.caregiverId)
  const principal = caregiver === null ? null : caregiverPrincipalFrom(caregiver)
  if (principal === null) return { ok: false, refusal: 'NO_CODE' }

  await setSessionCookie({ sub: principal.caregiverId, agencyId: principal.agencyId }, now)
  await deleteCodeCookie()
  return { ok: true }
}

// The principal is rebuilt from the Caregiver row every request, so a withdrawal ends the
// session on the next request with no cookie invalidation.
export const getCaregiverSession: () => Promise<CaregiverPrincipal | null> = cache(async () => {
  const claims = await readSessionCookie()
  if (claims === null) return null

  const caregiver = await findCaregiverForSession(claims.agencyId, claims.sub)
  return caregiver === null ? null : caregiverPrincipalFrom(caregiver)
})

export async function requireCaregiverSession(): Promise<CaregiverPrincipal> {
  const principal = await getCaregiverSession()
  if (principal === null) redirect('/verify')
  return principal
}

export async function signOutCaregiver(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
