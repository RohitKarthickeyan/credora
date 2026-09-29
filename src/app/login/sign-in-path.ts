import type { StaffSignInResult } from '@/server/auth/session'

const PATHS: Record<StaffSignInResult, string> = {
  SIGNED_IN: '/',
  VERIFY: '/login/mfa',
  ENROL: '/login/mfa/setup',
  FAILED: '/login',
}

export function pathAfterSignIn(result: StaffSignInResult): string {
  return PATHS[result]
}
