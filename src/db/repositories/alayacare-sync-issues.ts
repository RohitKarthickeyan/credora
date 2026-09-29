import { type ProfileChoices, profileChoicesSchema } from '@/domain/sync/alayacare-conflict'
import { type AuditedTx, runInAuditedTransaction } from '../audit'
import type { JobState } from './jobs'

export type AlayaCareSyncIssueRow = {
  readonly caregiverId: string
  readonly legalFirstName: string | null
  readonly legalLastName: string | null
  readonly jobId: string
  /** null when the Job row no longer exists. */
  readonly jobState: JobState | null
  readonly status: 'CONFLICT' | 'REJECTED'
  readonly conflictFields: readonly string[]
  readonly reason: string
  readonly finishedAt: Date
  /** The latest externalId recorded on ANY of the caregiver's rows: startAlayaCareSync's rule. */
  readonly knownExternalId: string | null
  readonly choices: ProfileChoices
}

function toChoices(keepOursFields: readonly string[], keepTheirsFields: readonly string[]): ProfileChoices {
  return profileChoicesSchema.parse(
    Object.fromEntries([
      ...keepOursFields.map((field) => [field, 'OURS']),
      ...keepTheirsFields.map((field) => [field, 'THEIRS']),
    ]),
  )
}

async function issueRows(tx: AuditedTx, agencyId: string, caregiverId?: string): Promise<readonly AlayaCareSyncIssueRow[]> {
  const latest = await tx.alayaCareSync.findMany({
    where: { agencyId, ...(caregiverId === undefined ? {} : { caregiverId }), caregiver: { stage: 'SYNCING' } },
    distinct: ['caregiverId'],
    orderBy: [{ caregiverId: 'asc' }, { startedAt: 'desc' }, { id: 'desc' }],
    select: {
      caregiverId: true,
      jobId: true,
      status: true,
      conflictFields: true,
      reason: true,
      finishedAt: true,
      keepOursFields: true,
      keepTheirsFields: true,
      caregiver: { select: { identity: { select: { legalFirstName: true, legalLastName: true } } } },
    },
  })
  const stopped = latest.filter((row) => row.status === 'CONFLICT' || row.status === 'REJECTED')
  if (stopped.length === 0) return []

  const jobs = await tx.job.findMany({
    where: { agencyId, id: { in: stopped.map((row) => row.jobId) } },
    select: { id: true, state: true },
  })
  const known = await tx.alayaCareSync.findMany({
    where: { agencyId, caregiverId: { in: stopped.map((row) => row.caregiverId) }, externalId: { not: null } },
    distinct: ['caregiverId'],
    orderBy: [{ caregiverId: 'asc' }, { startedAt: 'desc' }, { id: 'desc' }],
    select: { caregiverId: true, externalId: true },
  })

  return stopped
    .map((row) => {
      const { status, reason, finishedAt } = row
      // finishAlayaCareSync always sets both for CONFLICT and REJECTED; a null is corrupt data.
      if ((status !== 'CONFLICT' && status !== 'REJECTED') || reason === null || finishedAt === null) {
        throw new Error(`AlayaCareSync for job ${row.jobId} is ${status} with no reason or finish time.`)
      }
      const identity = row.caregiver.identity
      return {
        caregiverId: row.caregiverId,
        legalFirstName: identity?.legalFirstName ?? null,
        legalLastName: identity?.legalLastName ?? null,
        jobId: row.jobId,
        jobState: jobs.find((job) => job.id === row.jobId)?.state ?? null,
        status,
        conflictFields: row.conflictFields,
        reason,
        finishedAt,
        knownExternalId: known.find((entry) => entry.caregiverId === row.caregiverId)?.externalId ?? null,
        choices: toChoices(row.keepOursFields, row.keepTheirsFields),
      }
    })
    .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())
}

/** Per SYNCING caregiver in the agency, the latest AlayaCareSync row, kept only when CONFLICT or
 *  REJECTED. Newest finishedAt first. */
export function listAlayaCareSyncIssueRows(tx: AuditedTx, agencyId: string): Promise<readonly AlayaCareSyncIssueRow[]> {
  return issueRows(tx, agencyId)
}

/** The same row for one caregiver, or null (no row, latest not CONFLICT/REJECTED, not SYNCING, other agency). */
export async function findAlayaCareSyncIssueRow(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
): Promise<AlayaCareSyncIssueRow | null> {
  const [row] = await issueRows(tx, agencyId, caregiverId)
  return row ?? null
}

/** Replaces keepOursFields / keepTheirsFields on the job's row with `choices`. */
export async function recordAlayaCareProfileChoices(
  tx: AuditedTx,
  agencyId: string,
  jobId: string,
  choices: ProfileChoices,
): Promise<void> {
  const entries = Object.entries(choices)
  await tx.alayaCareSync.update({
    where: { agencyId_jobId: { agencyId, jobId } },
    data: {
      keepOursFields: entries.filter(([, choice]) => choice === 'OURS').map(([field]) => field),
      keepTheirsFields: entries.filter(([, choice]) => choice === 'THEIRS').map(([field]) => field),
    },
  })
}

/** The job's recorded choices; {} when it has no row. */
export function findAlayaCareProfileChoices(agencyId: string, jobId: string): Promise<ProfileChoices> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.alayaCareSync.findUnique({
      where: { agencyId_jobId: { agencyId, jobId } },
      select: { keepOursFields: true, keepTheirsFields: true },
    })
    return row === null ? {} : toChoices(row.keepOursFields, row.keepTheirsFields)
  })
}
