import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { findAlayaCareSyncSubject, recordAlayaCareExternalId } from '@/db/repositories/alayacare-sync'
import {
  type AlayaCareSyncIssueRow,
  findAlayaCareSyncIssueRow,
  listAlayaCareSyncIssueRows,
  recordAlayaCareProfileChoices,
} from '@/db/repositories/alayacare-sync-issues'
import { requeueJob } from '@/db/repositories/jobs'
import { type ProfileChoices, profileChoicesSchema } from '@/domain/sync/alayacare-conflict'
import { type AlayaCareProfileFields, projectAlayaCareProfile } from '@/domain/sync/alayacare-sync'
import type { AlayaCareProfile, FindProfileInput } from '@/integrations/ports/alayacare'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { getPort } from '@/integrations/registry'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type AlayaCareSyncIssueSummary = {
  readonly caregiverId: string
  readonly name: string | null
  readonly status: 'CONFLICT' | 'REJECTED'
  readonly conflictFields: readonly string[]
  readonly reason: string
  readonly finishedAt: Date
  readonly canRetry: boolean
}

function nameOf(row: AlayaCareSyncIssueRow): string | null {
  const parts = [row.legalFirstName, row.legalLastName].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
}

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry: a list of names and field names, like the pipeline board (ADR-051).
export const listAlayaCareSyncIssues: UseCase<Record<string, never>, readonly AlayaCareSyncIssueSummary[]> =
  defineUseCase('alayaCareSync.view', async ({ principal }) => {
    const rows = await runInAuditedTransaction((tx) => listAlayaCareSyncIssueRows(tx, principal.agencyId))
    return rows.map((row) => ({
      caregiverId: row.caregiverId,
      name: nameOf(row),
      status: row.status,
      conflictFields: row.conflictFields,
      reason: row.reason,
      finishedAt: row.finishedAt,
      canRetry: row.jobState === 'DEAD',
    }))
  })

export type AlayaCareSide =
  | { readonly kind: 'LINKED'; readonly externalId: string; readonly profile: AlayaCareProfile | null }
  | { readonly kind: 'CANDIDATE'; readonly profile: AlayaCareProfile & { readonly externalId: string } }
  | { readonly kind: 'NO_MATCH' }
  | { readonly kind: 'UNAVAILABLE' }

type AlayaCareSyncIssueDetail = {
  readonly caregiverId: string
  readonly name: string | null
  readonly status: 'CONFLICT' | 'REJECTED'
  readonly reason: string
  readonly conflictFields: readonly string[]
  readonly canRetry: boolean
  readonly ours: AlayaCareProfileFields
  readonly alayaCare: AlayaCareSide
  readonly choices: ProfileChoices
}

async function ourProfile(agencyId: string, caregiverId: string): Promise<AlayaCareProfileFields> {
  const subject = await findAlayaCareSyncSubject(agencyId, caregiverId)
  const projected = subject === null ? null : projectAlayaCareProfile(subject.profile)
  // A logged sync implies a projectable record: the job projects before it logs.
  if (projected === null || !projected.ok) throw new Error(`Caregiver ${caregiverId} has a sync log but no projectable profile.`)
  return projected.profile
}

/** null when AlayaCare did not answer (a VendorUnavailableError); every other throw escapes. */
async function findProfileOrUnavailable(
  lookup: FindProfileInput,
): Promise<{ readonly available: true; readonly profile: AlayaCareProfile | null } | { readonly available: false }> {
  try {
    return { available: true, profile: await getPort('alayacare').findProfile(lookup) }
  } catch (error) {
    if (error instanceof VendorUnavailableError) return { available: false }
    throw error
  }
}

function identityLookup(agencyId: string, ours: AlayaCareProfileFields): FindProfileInput {
  return { agencyId, lookup: { by: 'identity', lastName: ours.lastName, dateOfBirth: ours.dateOfBirth } }
}

// One VIEW per open of a found issue, none for a miss (ADR-094). AlayaCare is read live once per
// call and nothing it returns is stored (ADR-147).
export const getAlayaCareSyncIssue: UseCase<{ readonly caregiverId: string }, AlayaCareSyncIssueDetail | null> =
  defineUseCase('alayaCareSync.view', async ({ principal, input }) => {
    const { agencyId } = principal
    const row = await runInAuditedTransaction(async (tx) => {
      const found = await findAlayaCareSyncIssueRow(tx, agencyId, input.caregiverId)
      if (found !== null) {
        await writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: found.caregiverId })
      }
      return found
    })
    if (row === null) return null

    const ours = await ourProfile(agencyId, row.caregiverId)
    const known = row.knownExternalId
    const read = await findProfileOrUnavailable(
      known === null ? identityLookup(agencyId, ours) : { agencyId, lookup: { by: 'externalId', externalId: known } },
    )

    let alayaCare: AlayaCareSide = { kind: 'UNAVAILABLE' }
    if (read.available && known !== null) alayaCare = { kind: 'LINKED', externalId: known, profile: read.profile }
    else if (read.available) {
      const candidate = read.profile
      alayaCare =
        candidate === null || candidate.externalId === null
          ? { kind: 'NO_MATCH' }
          : { kind: 'CANDIDATE', profile: { ...candidate, externalId: candidate.externalId } }
    }

    return {
      caregiverId: row.caregiverId,
      name: nameOf(row),
      status: row.status,
      reason: row.reason,
      conflictFields: row.conflictFields,
      canRetry: row.jobState === 'DEAD',
      ours,
      alayaCare,
      choices: row.choices,
    }
  })

export type RetryAlayaCareSyncResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'NO_ISSUE' | 'NOT_DEAD' | 'INVALID_CHOICE' }

// A retry with no choices is not audited, like the exception queue's retry (ADR-112); the rerun's
// own success writes the EXPORT entry (ADR-116). Choices commit before the requeue, so a job claimed
// at once already sees them (ADR-146).
export const retryAlayaCareSync: UseCase<
  { readonly caregiverId: string; readonly choices: ProfileChoices },
  RetryAlayaCareSyncResult
> = defineUseCase('alayaCareSync.resolve', async ({ principal, input }) => {
  const { agencyId } = principal
  const choices = profileChoicesSchema.parse(input.choices)
  const chosen = Object.keys(choices)

  type Refusal = Extract<RetryAlayaCareSyncResult, { ok: false }>['reason']
  const checked = await runInAuditedTransaction(async (tx): Promise<AlayaCareSyncIssueRow | Refusal> => {
    const row = await findAlayaCareSyncIssueRow(tx, agencyId, input.caregiverId)
    if (row === null) return 'NO_ISSUE'
    if (row.jobState !== 'DEAD') return 'NOT_DEAD'
    if (chosen.length > 0 && (row.knownExternalId === null || chosen.some((field) => !row.conflictFields.includes(field)))) {
      return 'INVALID_CHOICE'
    }
    if (chosen.length > 0) {
      await recordAlayaCareProfileChoices(tx, agencyId, row.jobId, { ...row.choices, ...choices })
      for (const fieldName of chosen) {
        await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'CAREGIVER', entityId: row.caregiverId, fieldName })
      }
    }
    return row
  })
  if (typeof checked === 'string') return { ok: false, reason: checked }

  const requeued = await requeueJob(agencyId, checked.jobId, new Date())
  return requeued === null ? { ok: false, reason: 'NOT_DEAD' } : { ok: true }
})

export type LinkAlayaCareEmployeeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'NO_ISSUE' | 'ALREADY_LINKED' | 'NOT_DEAD' | 'MATCH_CHANGED' | 'ALAYACARE_UNAVAILABLE'
    }

// Staff-confirmed only: the sync never links by itself (ADR-147). The identity lookup is re-run so
// the id recorded is the one AlayaCare matches now, not merely the one the page showed.
export const linkAlayaCareEmployee: UseCase<
  { readonly caregiverId: string; readonly externalId: string },
  LinkAlayaCareEmployeeResult
> = defineUseCase('alayaCareSync.resolve', async ({ principal, input }) => {
  const { agencyId } = principal
  const row = await runInAuditedTransaction((tx) => findAlayaCareSyncIssueRow(tx, agencyId, input.caregiverId))
  if (row === null) return { ok: false, reason: 'NO_ISSUE' }
  if (row.knownExternalId !== null) return { ok: false, reason: 'ALREADY_LINKED' }
  if (row.jobState !== 'DEAD') return { ok: false, reason: 'NOT_DEAD' }

  const read = await findProfileOrUnavailable(identityLookup(agencyId, await ourProfile(agencyId, row.caregiverId)))
  if (!read.available) return { ok: false, reason: 'ALAYACARE_UNAVAILABLE' }
  if (read.profile === null || read.profile.externalId !== input.externalId) return { ok: false, reason: 'MATCH_CHANGED' }

  await runInAuditedTransaction(async (tx) => {
    await recordAlayaCareExternalId(agencyId, row.jobId, input.externalId)
    await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'CAREGIVER', entityId: row.caregiverId, fieldName: 'externalId' })
  })

  const requeued = await requeueJob(agencyId, row.jobId, new Date())
  return requeued === null ? { ok: false, reason: 'NOT_DEAD' } : { ok: true }
})
