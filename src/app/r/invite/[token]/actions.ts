'use server'

import { redirect } from 'next/navigation'
import type { LinkRefusal } from '@/domain/auth/link-token'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { acceptInvite } from '@/server/caregivers/invite-link'

// An accepted invite starts intake, the same target as CAREGIVER_HOME.
const INVITE_START_PATH = '/intake'

export type StartOnboardingState = { readonly outcome?: 'NOT_YOURS' | LinkRefusal }

export async function startOnboarding(token: string): Promise<StartOnboardingState> {
  const principal = await requireCaregiverSession()
  const result = await acceptInvite(token, { caregiverId: principal.caregiverId })
  if (!result.ok) return { outcome: result.refusal }
  if (result.value === 'NOT_YOURS') return { outcome: 'NOT_YOURS' }

  redirect(INVITE_START_PATH)
}
