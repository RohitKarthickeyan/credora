import { z } from 'zod'

type SecondFactorStep = 'NONE' | 'VERIFY' | 'ENROL'

// Per agency, all staff roles (OPEN-QUESTIONS 233). An enrolled user is always asked, even if the
// agency later stops requiring it: turning the flag off must not silently drop a factor.
export function secondFactorStep(state: {
  readonly mfaRequired: boolean
  readonly enrolled: boolean
}): SecondFactorStep {
  if (state.enrolled) return 'VERIFY'
  return state.mfaRequired ? 'ENROL' : 'NONE'
}

// Consecutive wrong codes before the second step locks until an admin reset (OPEN-QUESTIONS 235).
export const MFA_MAX_ATTEMPTS = 10
export const RECOVERY_CODE_COUNT = 10

const TOTP_MESSAGE = 'Enter the 6-digit code from your authenticator app.'

export const totpCodeSchema = z
  .string({ error: TOTP_MESSAGE })
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, TOTP_MESSAGE))

const SECOND_FACTOR_MESSAGE = 'Enter the 6-digit code from your app, or a recovery code.'

export const secondFactorCodeSchema = z
  .string({ error: SECOND_FACTOR_MESSAGE })
  .transform((value, context) => {
    const code = value.replace(/[\s-]/g, '').toUpperCase()
    if (/^\d{6}$/.test(code)) return { kind: 'TOTP' as const, code }
    if (/^[A-Z2-7]{16}$/.test(code)) return { kind: 'RECOVERY' as const, code }
    context.addIssue({ code: 'custom', message: SECOND_FACTOR_MESSAGE })
    return z.NEVER
  })

export type SecondFactorCode = z.infer<typeof secondFactorCodeSchema>

export type MfaRefusal = 'NO_CHALLENGE' | 'WRONG_CODE' | 'LOCKED'
