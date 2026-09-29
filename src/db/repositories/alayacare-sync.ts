import type { PipelineStage } from '@/domain/pipeline/stage'
import type { AlayaCareSyncSource, CredentialType } from '@/domain/sync/alayacare-mapping'
import type { AlayaCareProfileSource } from '@/domain/sync/alayacare-sync'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '../audit'
import { fromDateColumn } from '../mapping/date-only'

type AlayaCareSyncSubject = {
  readonly stage: PipelineStage
  readonly profile: AlayaCareProfileSource
  readonly recordFields: AlayaCareSyncSource['recordFields']
}

// An explicit select: no SSN, bank, work-authorisation, address, vaccination or payroll column
// is read, so none can reach AlayaCare.
export function findAlayaCareSyncSubject(agencyId: string, caregiverId: string): Promise<AlayaCareSyncSubject | null> {
  return runInAuditedTransaction(async (tx) => {
    const row = await tx.caregiver.findFirst({
      where: { id: caregiverId, agencyId },
      select: {
        stage: true,
        identity: { select: { legalFirstName: true, legalLastName: true, dateOfBirth: true } },
        contact: { select: { mobilePhone: true, alternatePhone: true, email: true, preferredLanguage: true } },
        homeCareProfile: {
          select: {
            certificationsHeld: true,
            clinicalSkills: true,
            shiftTypes: true,
            serviceAreas: true,
            languages: true,
            worksWithPets: true,
            worksWithSmokers: true,
            hasVehicle: true,
          },
        },
      },
    })
    if (row === null) return null

    const { identity, contact, homeCareProfile: profile } = row
    return {
      stage: row.stage,
      profile: {
        legalFirstName: identity?.legalFirstName ?? null,
        legalLastName: identity?.legalLastName ?? null,
        dateOfBirth: fromDateColumn(identity?.dateOfBirth ?? null),
        email: contact?.email ?? null,
        mobilePhone: contact?.mobilePhone ?? null,
      },
      recordFields: {
        mobilePhone: contact?.mobilePhone ?? null,
        alternatePhone: contact?.alternatePhone ?? null,
        email: contact?.email ?? null,
        preferredLanguage: contact?.preferredLanguage ?? null,
        certificationsHeld: profile?.certificationsHeld ?? null,
        clinicalSkills: profile?.clinicalSkills ?? null,
        shiftTypes: profile?.shiftTypes ?? null,
        serviceAreas: profile?.serviceAreas ?? null,
        languages: profile?.languages ?? null,
        worksWithPets: profile?.worksWithPets ?? null,
        worksWithSmokers: profile?.worksWithSmokers ?? null,
        hasVehicle: profile?.hasVehicle ?? null,
      },
    }
  })
}

type StartAlayaCareSyncInput = {
  readonly caregiverId: string
  readonly jobId: string
  readonly mappingVersion: number
  readonly unmappedCredentialTypes: readonly CredentialType[]
  readonly unresolvedCustomFields: readonly string[]
  readonly startedAt: Date
}

/** Creates the job's row as RUNNING, or refreshes it on a retry, and returns the AlayaCare id
 *  the caregiver's most recent sync recorded. */
export function startAlayaCareSync(
  agencyId: string,
  input: StartAlayaCareSyncInput,
): Promise<{ readonly externalId: string | null }> {
  return runInAuditedTransaction(async (tx) => {
    const lists = {
      mappingVersion: input.mappingVersion,
      unmappedCredentialTypes: [...input.unmappedCredentialTypes],
      unresolvedCustomFields: [...input.unresolvedCustomFields],
    }
    await tx.alayaCareSync.upsert({
      where: { agencyId_jobId: { agencyId, jobId: input.jobId } },
      create: {
        agencyId,
        caregiverId: input.caregiverId,
        jobId: input.jobId,
        conflictFields: [],
        startedAt: input.startedAt,
        ...lists,
      },
      update: lists,
    })
    const known = await tx.alayaCareSync.findFirst({
      where: { agencyId, caregiverId: input.caregiverId, externalId: { not: null } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { externalId: true },
    })
    return { externalId: known?.externalId ?? null }
  })
}

export async function recordAlayaCareExternalId(agencyId: string, jobId: string, externalId: string): Promise<void> {
  await runInAuditedTransaction((tx) =>
    tx.alayaCareSync.update({ where: { agencyId_jobId: { agencyId, jobId } }, data: { externalId } }),
  )
}

export type AlayaCareSyncResult =
  | { readonly status: 'SYNCED'; readonly credentialsWritten: number }
  | {
      readonly status: 'CONFLICT'
      readonly credentialsWritten: number
      readonly conflictFields: readonly string[]
      readonly reason: string
    }
  | { readonly status: 'REJECTED'; readonly credentialsWritten: number; readonly reason: string }

/** Sending the record to AlayaCare is an export (SECURITY.md § Audit log), so SYNCED is audited. */
export async function finishAlayaCareSync(
  tx: AuditedTx,
  agencyId: string,
  input: {
    readonly caregiverId: string
    readonly jobId: string
    readonly finishedAt: Date
    readonly result: AlayaCareSyncResult
  },
): Promise<void> {
  const { result } = input
  await tx.alayaCareSync.update({
    where: { agencyId_jobId: { agencyId, jobId: input.jobId } },
    data: {
      status: result.status,
      credentialsWritten: result.credentialsWritten,
      conflictFields: result.status === 'CONFLICT' ? [...result.conflictFields] : [],
      reason: result.status === 'SYNCED' ? null : result.reason,
      finishedAt: input.finishedAt,
    },
  })
  if (result.status === 'SYNCED') {
    await writeAuditEntry(tx, { agencyId, action: 'EXPORT', entityType: 'CAREGIVER', entityId: input.caregiverId })
  }
}

/** True once any caregiver of the agency has a SYNCED sync (ADR-116): the agency's first sync is done. */
export function hasAgencySyncedToAlayaCare(agencyId: string): Promise<boolean> {
  return runInAuditedTransaction(async (tx) => {
    const synced = await tx.alayaCareSync.findFirst({
      where: { agencyId, status: 'SYNCED' },
      select: { id: true },
    })
    return synced !== null
  })
}
