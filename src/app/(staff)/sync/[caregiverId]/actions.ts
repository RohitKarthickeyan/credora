'use server'

import { revalidatePath } from 'next/cache'
import { RESOLVABLE_PROFILE_FIELDS, profileChoicesSchema } from '@/domain/sync/alayacare-conflict'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import type { LinkAlayaCareEmployeeResult, RetryAlayaCareSyncResult } from '@/server/sync/alayacare-sync-issues'
import { linkAlayaCareEmployee, retryAlayaCareSync } from '@/server/sync/alayacare-sync-issues'

type SyncIssueActionState = { readonly error?: string }

const NO_ISSUE = 'This sync is no longer waiting on staff. Refresh the page.'
const NOT_DEAD = 'A retry is already queued.'

const RETRY_REFUSALS = {
  NO_ISSUE,
  NOT_DEAD,
  INVALID_CHOICE: 'Those choices no longer match the conflicting fields. Refresh the page.',
} as const satisfies Record<Extract<RetryAlayaCareSyncResult, { ok: false }>['reason'], string>

const LINK_REFUSALS = {
  NO_ISSUE,
  NOT_DEAD,
  ALREADY_LINKED: 'This caregiver is already linked to an AlayaCare employee. Refresh the page.',
  MATCH_CHANGED: 'AlayaCare no longer matches this caregiver to that employee. Refresh the page.',
  ALAYACARE_UNAVAILABLE: 'AlayaCare is not responding. Try again in a moment.',
} as const satisfies Record<Extract<LinkAlayaCareEmployeeResult, { ok: false }>['reason'], string>

function text(formData: FormData, field: string): string {
  const value = formData.get(field)
  return typeof value === 'string' ? value : ''
}

function revalidate(caregiverId: string): void {
  revalidatePath('/sync')
  revalidatePath(`/sync/${caregiverId}`)
}

export async function retrySyncAction(_previous: SyncIssueActionState, formData: FormData): Promise<SyncIssueActionState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')
  const choices = profileChoicesSchema.safeParse(
    Object.fromEntries(
      RESOLVABLE_PROFILE_FIELDS.flatMap((field) => {
        const choice = text(formData, `choice.${field}`)
        return choice === '' ? [] : [[field, choice]]
      }),
    ),
  )
  if (!choices.success) return { error: 'Choose which value AlayaCare keeps for each field.' }

  const result = await runAsPrincipal(principal, {}, () => retryAlayaCareSync({ caregiverId, choices: choices.data }))
  if (!result.ok) return { error: RETRY_REFUSALS[result.reason] }

  revalidate(caregiverId)
  return {}
}

export async function linkEmployeeAction(_previous: SyncIssueActionState, formData: FormData): Promise<SyncIssueActionState> {
  const { principal } = await requireStaffSession()
  const caregiverId = text(formData, 'caregiverId')
  const externalId = text(formData, 'externalId')

  const result = await runAsPrincipal(principal, {}, () => linkAlayaCareEmployee({ caregiverId, externalId }))
  if (!result.ok) return { error: LINK_REFUSALS[result.reason] }

  revalidate(caregiverId)
  return {}
}
