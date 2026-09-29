import { differenceInMinutes, subDays } from 'date-fns'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { PipelineEventType } from '@/domain/pipeline/transitions'
import type { AlayaCareSyncStatus } from '@/domain/sync/alayacare-sync'

const SUCCESS_METRICS_WINDOW_DAYS = 90

// Only staff corrections of a value the caregiver already supplied. Staff decisions (document
// decisions, waivers, check results, stage moves, conflict choices, AlayaCare links) are not
// re-typing and do not belong here.
export const STAFF_RETYPED_FIELDS = ['email'] as const

export type ReportWindow = { readonly start: Date; readonly end: Date }

export function successMetricsWindow(now: Date): ReportWindow {
  return { start: subDays(now, SUCCESS_METRICS_WINDOW_DAYS), end: now }
}

export type SuccessMetricsFacts = {
  readonly clearances: readonly { readonly invitedAt: Date; readonly clearedAt: Date }[]
  readonly paperworkStarts: readonly { readonly stage: PipelineStage; readonly events: readonly PipelineEventType[] }[]
  readonly retypedFields: number
  readonly autoAccept: { readonly decided: number; readonly autoAccepted: number }
  readonly finishedSyncs: readonly { readonly status: Exclude<AlayaCareSyncStatus, 'RUNNING'>; readonly runs: number }[]
}

export type Ratio = { readonly count: number; readonly of: number }

export type SuccessMetricsReport = {
  readonly window: ReportWindow
  readonly daysToCleared: { readonly caregivers: number; readonly medianMinutes: number | null }
  readonly paperwork: {
    readonly started: number
    readonly finished: number
    readonly stopped: number
    readonly inProgress: number
  }
  readonly fieldsRetyped: { readonly caregivers: number; readonly fields: number }
  readonly autoAccepted: Ratio
  readonly syncsWithoutManualFix: Ratio
}

// The lower middle on an even count keeps the median a whole number of minutes.
function medianMinutes(clearances: SuccessMetricsFacts['clearances']): number | null {
  const minutes = clearances
    .map(({ invitedAt, clearedAt }) => differenceInMinutes(clearedAt, invitedAt))
    .sort((a, b) => a - b)
  return minutes[Math.floor((minutes.length - 1) / 2)] ?? null
}

type PaperworkOutcome = 'FINISHED' | 'STOPPED' | 'IN_PROGRESS'

function paperworkOutcome(start: SuccessMetricsFacts['paperworkStarts'][number]): PaperworkOutcome {
  if (start.events.includes('ENVELOPE_COMPLETED')) return 'FINISHED'
  if (start.stage === 'WITHDRAWN') return 'STOPPED'
  return 'IN_PROGRESS'
}

// A stopped sync is fixed only by requeueing its job, which starts a second run; a sync whose
// runs cannot be seen is not claimed as clean.
function isSyncWithoutManualFix(sync: SuccessMetricsFacts['finishedSyncs'][number]): boolean {
  return sync.status === 'SYNCED' && sync.runs === 1
}

export function summariseSuccessMetrics(window: ReportWindow, facts: SuccessMetricsFacts): SuccessMetricsReport {
  const outcomes = facts.paperworkStarts.map(paperworkOutcome)
  const countOf = (outcome: PaperworkOutcome) => outcomes.filter((o) => o === outcome).length

  return {
    window,
    daysToCleared: { caregivers: facts.clearances.length, medianMinutes: medianMinutes(facts.clearances) },
    paperwork: {
      started: outcomes.length,
      finished: countOf('FINISHED'),
      stopped: countOf('STOPPED'),
      inProgress: countOf('IN_PROGRESS'),
    },
    fieldsRetyped: { caregivers: facts.clearances.length, fields: facts.retypedFields },
    autoAccepted: { count: facts.autoAccept.autoAccepted, of: facts.autoAccept.decided },
    syncsWithoutManualFix: {
      count: facts.finishedSyncs.filter(isSyncWithoutManualFix).length,
      of: facts.finishedSyncs.length,
    },
  }
}
