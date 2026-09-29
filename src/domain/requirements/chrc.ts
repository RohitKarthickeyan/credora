import { z } from 'zod'
import type { InstanceStatus } from './instance-status'
import { compareNames } from './manual-check'

export const CHRC_REQUIREMENT_KEY = 'CHRC'
export const CHRC_RESULT_EVIDENCE_KEY = 'CHRC_RESULT'

const CHRC_STEPS = ['SUBMISSION', 'RESULT'] as const
export type ChrcStep = (typeof CHRC_STEPS)[number]
export type ChrcRefusal = 'ALREADY_SUBMITTED' | 'NOT_SUBMITTED' | 'ALREADY_RECORDED' | 'NOT_OUTSTANDING'

// A submission moves NOT_STARTED → PENDING; a result moves PENDING → SATISFIED. Every other
// status (WAIVED, IN_REVIEW, EXCEPTION, EXPIRED) is not tracking's to move.
export function chrcStepRefusal(step: ChrcStep, status: InstanceStatus, submitted: boolean): ChrcRefusal | null {
  if (step === 'SUBMISSION') {
    if (submitted) return 'ALREADY_SUBMITTED'
    if (status === 'NOT_STARTED') return null
    return status === 'SATISFIED' ? 'ALREADY_RECORDED' : 'NOT_OUTSTANDING'
  }
  if (status === 'SATISFIED') return 'ALREADY_RECORDED'
  if (!submitted) return 'NOT_SUBMITTED'
  return status === 'PENDING' ? null : 'NOT_OUTSTANDING'
}

function chrcNextStep(status: InstanceStatus, submitted: boolean): ChrcStep | null {
  return CHRC_STEPS.find((step) => chrcStepRefusal(step, status, submitted) === null) ?? null
}

export type ChrcRow = {
  readonly instanceId: string
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly status: InstanceStatus
  readonly submittedAt: Date | null
}

export type ChrcTask = ChrcRow & { readonly nextStep: ChrcStep }

export function outstandingChrcChecks(rows: readonly ChrcRow[]): readonly ChrcTask[] {
  const tasks: ChrcTask[] = []
  for (const row of rows) {
    const nextStep = chrcNextStep(row.status, row.submittedAt !== null)
    if (nextStep !== null) tasks.push({ ...row, nextStep })
  }

  return tasks.sort(
    (a, b) => compareNames(a.caregiverName, b.caregiverName) || a.instanceId.localeCompare(b.instanceId),
  )
}

export const recordChrcStepInputSchema = z.strictObject({
  instanceId: z.string().min(1),
  step: z.enum(CHRC_STEPS),
})
