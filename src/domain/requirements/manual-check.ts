import { z } from 'zod'
import type { InstanceStatus } from './instance-status'
import { satisfactionPath } from './manual-only'
import type { RequirementTemplate } from './template'

type ManualCheckTemplate = Pick<
  RequirementTemplate,
  'name' | 'manualOnly' | 'manualOnlyReason' | 'acceptedEvidence'
>

type ManualCheck = {
  readonly evidenceKey: string
  readonly reason: string
}

/** The one check a person records to satisfy a manual-only requirement, or null. */
export function manualCheckOf(
  template: Pick<RequirementTemplate, 'manualOnly' | 'manualOnlyReason' | 'acceptedEvidence'>,
): ManualCheck | null {
  const path = satisfactionPath(template)
  if (path.kind !== 'MANUAL_ONLY') return null

  const [only, ...rest] = template.acceptedEvidence.filter(({ kind }) => kind === 'CHECK_RESULT')
  if (only === undefined || rest.length > 0) return null
  return { evidenceKey: only.evidenceKey, reason: path.reason }
}

export type ManualCheckRefusal = 'ALREADY_SATISFIED' | 'WAIVED'

type ManualCheckPath =
  | { readonly ok: true; readonly steps: readonly InstanceStatus[] }
  | { readonly ok: false; readonly refusal: ManualCheckRefusal }

// There is no NOT_STARTED → SATISFIED edge, so an untouched instance goes through PENDING.
const MANUAL_CHECK_PATHS: Readonly<Record<InstanceStatus, ManualCheckPath>> = {
  NOT_STARTED: { ok: true, steps: ['PENDING', 'SATISFIED'] },
  EXPIRED: { ok: true, steps: ['PENDING', 'SATISFIED'] },
  PENDING: { ok: true, steps: ['SATISFIED'] },
  IN_REVIEW: { ok: true, steps: ['SATISFIED'] },
  EXCEPTION: { ok: true, steps: ['SATISFIED'] },
  SATISFIED: { ok: false, refusal: 'ALREADY_SATISFIED' },
  WAIVED: { ok: false, refusal: 'WAIVED' },
}

export function manualCheckPath(from: InstanceStatus): ManualCheckPath {
  return MANUAL_CHECK_PATHS[from]
}

export type ManualCheckRow = {
  readonly instanceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly status: InstanceStatus
  readonly template: ManualCheckTemplate
}

export type ManualCheckTask = {
  readonly instanceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly requirementName: string
  readonly reason: string
  readonly status: InstanceStatus
}

export function compareNames(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}

export function outstandingManualChecks(rows: readonly ManualCheckRow[]): readonly ManualCheckTask[] {
  const tasks: ManualCheckTask[] = []
  for (const row of rows) {
    const check = manualCheckOf(row.template)
    if (check === null || !manualCheckPath(row.status).ok) continue
    tasks.push({
      instanceId: row.instanceId,
      caregiverId: row.caregiverId,
      caregiverName: row.caregiverName,
      requirementName: row.template.name,
      reason: check.reason,
      status: row.status,
    })
  }

  return tasks.sort(
    (a, b) =>
      compareNames(a.caregiverName, b.caregiverName) ||
      a.requirementName.localeCompare(b.requirementName) ||
      a.instanceId.localeCompare(b.instanceId),
  )
}

export const recordManualCheckInputSchema = z.strictObject({
  instanceId: z.string().min(1),
})
