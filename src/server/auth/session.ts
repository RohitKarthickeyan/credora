import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import {
  acceptStaffTotpStep,
  completeStaffMfaEnrolment,
  consumeStaffRecoveryCode,
  ensureStaffMfaEnrolment,
  findStaffSecondFactorState,
  recordStaffMfaAttempt,
} from '@/db/repositories/staff-mfa'
import { findUserForSession, findUserForSignIn } from '@/db/repositories/users'
import type { StaffCredentials } from '@/domain/auth/credentials'
import type { MfaRefusal, SecondFactorCode } from '@/domain/auth/mfa'
import { MFA_MAX_ATTEMPTS, RECOVERY_CODE_COUNT, secondFactorStep } from '@/domain/auth/mfa'
import type { Principal } from '@/domain/auth/role'
import { staffPrincipalFrom } from '@/domain/auth/staff-principal'
import { env } from '@/lib/env'
import { verifyPassword } from '@/lib/password'
import { generateRecoveryCode, hashRecoveryCode } from '@/lib/recovery-code'
import { generateTotpSecret, matchTotp, totpUri } from '@/lib/totp'
import { runAsPrincipal } from './context'

type StaffSession = { readonly principal: Principal; readonly fullName: string }

const COOKIE_NAME = 'credora_staff_session'
const MFA_COOKIE_NAME = 'credora_staff_mfa'
// The session token has no audience, so it cannot verify as a pending one; the session claims
// schema is strict, so a pending token (which carries `aud`) fails there (ADR-143).
const MFA_AUDIENCE = 'credora:staff-mfa'

// Absolute, no sliding refresh or idle timeout: one shift. A product-owner default (ADR-026).
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
// Time allowed between the password and the code (OPEN-QUESTIONS 238).
const MFA_PENDING_LIFETIME_MS = 10 * 60 * 1000

// A cost-12 hash of a random string nobody knows. An unknown email is checked against it so that
// it costs the same time as a wrong password and the response time cannot reveal who has an account.
const DUMMY_HASH = '$2b$12$In4ZeiXOITxypjzFduj7uu.17Oy9V9wn8uBFFIA5Xh1XoGBY5JZJm'

const key = new TextEncoder().encode(env.SESSION_SECRET)

// The cookie is a pointer, never a source of privilege: strict, so a token carrying a role or any
// other claim is refused rather than trusted (ADR-026). Role and agency come from the User row.
const claimsSchema = z.strictObject({
  sub: z.string().min(1),
  agencyId: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
})

const pendingClaimsSchema = claimsSchema.extend({ aud: z.literal(MFA_AUDIENCE) })

export type StaffSignInResult = 'FAILED' | 'SIGNED_IN' | 'VERIFY' | 'ENROL'

type StaffMfaChallenge =
  | { readonly step: 'VERIFY' }
  | { readonly step: 'ENROL'; readonly secret: string; readonly otpauthUri: string }

type MfaRefused = { readonly ok: false; readonly refusal: MfaRefusal }

async function setCookie(name: string, token: string, path: string, expires: Date): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(name, token, { httpOnly: true, secure: true, sameSite: 'lax', path, expires })
}

// Called only after the password matched and, unless the step was NONE, a code was accepted.
async function setSessionCookie(principal: Principal, issuedAt: Date): Promise<void> {
  const expiresAt = new Date(issuedAt.getTime() + SESSION_LIFETIME_MS)
  const token = await new SignJWT({ agencyId: principal.agencyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key)
  await setCookie(COOKIE_NAME, token, '/', expiresAt)
}

async function setPendingCookie(principal: Principal, issuedAt: Date): Promise<void> {
  const expiresAt = new Date(issuedAt.getTime() + MFA_PENDING_LIFETIME_MS)
  const token = await new SignJWT({ agencyId: principal.agencyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.id)
    .setAudience(MFA_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key)
  await setCookie(MFA_COOKIE_NAME, token, '/login', expiresAt)
}

async function deletePendingCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete({ name: MFA_COOKIE_NAME, path: '/login' })
}

// Rebuilt from the User row, so a user deactivated or deleted between password and code is refused.
async function pendingPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(MFA_COOKIE_NAME)?.value
  if (token === undefined) return null

  const verified = await jwtVerify(token, key, {
    algorithms: ['HS256'],
    audience: MFA_AUDIENCE,
  }).catch(() => null)
  const claims = pendingClaimsSchema.safeParse(verified?.payload)
  if (!claims.success) return null

  const user = await findUserForSession(claims.data.agencyId, claims.data.sub)
  return user === null ? null : staffPrincipalFrom(user)
}

export async function signInStaff({ email, password }: StaffCredentials): Promise<StaffSignInResult> {
  const user = await findUserForSignIn(email)
  const matched = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!matched || !user?.passwordHash) return 'FAILED'

  const principal = staffPrincipalFrom(user)
  if (principal === null) return 'FAILED'

  const now = new Date()
  const step = secondFactorStep(await findStaffSecondFactorState(principal.agencyId, principal.id))
  if (step === 'NONE') {
    await setSessionCookie(principal, now)
    return 'SIGNED_IN'
  }
  await setPendingCookie(principal, now)
  return step
}

/** Stores a not-yet-confirmed secret if there is none, but sets no cookie, so a page may call it. */
export async function getStaffMfaChallenge(): Promise<StaffMfaChallenge | null> {
  const principal = await pendingPrincipal()
  if (principal === null) return null

  const enrolment = await ensureStaffMfaEnrolment(principal.agencyId, principal.id, generateTotpSecret())
  if (enrolment.enrolled) return { step: 'VERIFY' }
  return {
    step: 'ENROL',
    secret: enrolment.secret,
    otpauthUri: totpUri({ accountName: enrolment.email, secret: enrolment.secret }),
  }
}

function missed(attempts: number): MfaRefused {
  return { ok: false, refusal: attempts >= MFA_MAX_ATTEMPTS ? 'LOCKED' : 'WRONG_CODE' }
}

/** The recovery codes exist in plaintext only in this return value. */
export async function confirmStaffMfaEnrolment(
  code: string,
): Promise<{ readonly ok: true; readonly recoveryCodes: readonly string[] } | MfaRefused> {
  const principal = await pendingPrincipal()
  if (principal === null) return { ok: false, refusal: 'NO_CHALLENGE' }

  const { agencyId, id: userId } = principal
  const { counted, mfa } = await recordStaffMfaAttempt(agencyId, userId)
  if (mfa === null || mfa.enrolled) return { ok: false, refusal: 'NO_CHALLENGE' }
  if (!counted) return { ok: false, refusal: 'LOCKED' }

  const now = new Date()
  const step = matchTotp(mfa.secret, code, now)
  if (step === null) return missed(mfa.attempts)

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
  const completed = await runAsPrincipal(principal, {}, () =>
    runInAuditedTransaction(async (tx) => {
      const done = await completeStaffMfaEnrolment(tx, agencyId, userId, {
        step,
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        now,
      })
      if (done) {
        await writeAuditEntry(tx, {
          agencyId,
          action: 'EDIT',
          entityType: 'USER',
          entityId: userId,
          fieldName: 'totpSecretEnc',
        })
      }
      return done
    }),
  )
  if (!completed) return { ok: false, refusal: 'WRONG_CODE' }

  await setSessionCookie(principal, now)
  await deletePendingCookie()
  return { ok: true, recoveryCodes }
}

// Not audited: signing in is not an audited event (ADR-026, SECURITY.md § Audit log).
export async function verifyStaffSecondFactor(
  code: SecondFactorCode,
): Promise<{ readonly ok: true } | MfaRefused> {
  const principal = await pendingPrincipal()
  if (principal === null) return { ok: false, refusal: 'NO_CHALLENGE' }

  const { agencyId, id: userId } = principal
  const { counted, mfa } = await recordStaffMfaAttempt(agencyId, userId)
  if (mfa === null || !mfa.enrolled) return { ok: false, refusal: 'NO_CHALLENGE' }
  if (!counted) return { ok: false, refusal: 'LOCKED' }

  const now = new Date()
  let accepted: boolean
  if (code.kind === 'TOTP') {
    const step = matchTotp(mfa.secret, code.code, now)
    accepted = step !== null && (await acceptStaffTotpStep(agencyId, userId, step))
  } else {
    const codeHash = hashRecoveryCode(code.code)
    accepted = await runInAuditedTransaction((tx) =>
      consumeStaffRecoveryCode(tx, agencyId, userId, codeHash, now),
    )
  }
  if (!accepted) return missed(mfa.attempts)

  await setSessionCookie(principal, now)
  await deletePendingCookie()
  return { ok: true }
}

export async function signOutStaff(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  await deletePendingCookie()
}

export const getStaffSession: () => Promise<StaffSession | null> = cache(async () => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (token === undefined) return null

  // Pinning the algorithm is what refuses `alg: none` and algorithm confusion. A bad signature or
  // an expired token is an expected outcome here, not an error: the visitor is simply signed out.
  const verified = await jwtVerify(token, key, { algorithms: ['HS256'] }).catch(() => null)
  const claims = claimsSchema.safeParse(verified?.payload)
  if (!claims.success) return null

  const user = await findUserForSession(claims.data.agencyId, claims.data.sub)
  if (user === null) return null

  const principal = staffPrincipalFrom(user)
  return principal === null ? null : { principal, fullName: user.fullName }
})

export async function requireStaffSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (session === null) redirect('/login')
  return session
}
