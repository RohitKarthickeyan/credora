import 'server-only'
import { createSchedule } from '@/db/repositories/job-schedules'
import { listAgencyIds } from '@/db/repositories/retention'
import { RETENTION_SWEEP_JOB_TYPE } from './retention-sweep-job'

const RETENTION_SCHEDULE_KEY = 'retention.sweep'

const DAY_SECONDS = 86_400

/**
 * One daily retention.sweep schedule per agency, created at worker boot (ADR-155); idempotent,
 * because createSchedule is on (agencyId, key).
 */
export async function ensureRetentionSchedules(now: Date): Promise<void> {
  for (const agencyId of await listAgencyIds()) {
    await createSchedule({
      agencyId,
      key: RETENTION_SCHEDULE_KEY,
      jobType: RETENTION_SWEEP_JOB_TYPE,
      payload: {},
      intervalSeconds: DAY_SECONDS,
      firstOccurrenceAt: now,
    })
  }
}
