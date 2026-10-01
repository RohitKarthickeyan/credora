import type { CurrentBlocker } from '@/domain/requirements/blocker'
import { PIPELINE_STAGES, type PipelineStage } from './stage'
import { isTerminal } from './transitions'

export const BOARD_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.filter((s) => !isTerminal(s))

const MS_PER_DAY = 86_400_000

// Whole elapsed 24-hour periods, not calendar days: date-fns differenceInDays counts local days
// and treats a DST day as 23 or 25 hours, which would make the answer depend on the process TZ.
export function daysInStage(
  since: { readonly createdAt: Date; readonly lastTransitionAt: Date | null },
  now: Date,
): number {
  const enteredAt = since.lastTransitionAt ?? since.createdAt
  return Math.floor((now.getTime() - enteredAt.getTime()) / MS_PER_DAY)
}

export type PipelineBoardEntry = {
  readonly caregiverId: string
  readonly name: string | null
  readonly stage: PipelineStage
  readonly daysInStage: number
  readonly blocker: CurrentBlocker | null
  readonly conversation: {
    readonly paused: boolean
    readonly handedOff: boolean
    readonly needsReply: boolean
  } | null
}

export type PipelineBoardColumn = {
  readonly stage: PipelineStage
  readonly entries: readonly PipelineBoardEntry[]
}

function longestInStageFirst(a: PipelineBoardEntry, b: PipelineBoardEntry): number {
  if (a.daysInStage !== b.daysInStage) return b.daysInStage - a.daysInStage
  return a.caregiverId < b.caregiverId ? -1 : a.caregiverId > b.caregiverId ? 1 : 0
}

export function groupByStage(entries: readonly PipelineBoardEntry[]): readonly PipelineBoardColumn[] {
  return BOARD_STAGES.map((stage) => ({
    stage,
    entries: entries.filter((e) => e.stage === stage).sort(longestInStageFirst),
  }))
}
