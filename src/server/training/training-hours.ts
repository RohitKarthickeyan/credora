import 'server-only'
import { z } from 'zod'
import { createSchedule, getScheduleByKey } from '@/db/repositories/job-schedules'
import {
  type LinkableCaregiver,
  type TrainingAccountLinkResult,
  type TrainingCourse,
  type TrainingImportSummary,
  type UnmatchedTrainingAccount,
  findLinkableCaregivers,
  findRecentTrainingImports,
  findTrainingCourses,
  findTrainingHoursSubjects,
  findUnmatchedTrainingAccounts,
  linkTrainingPlatformId,
} from '@/db/repositories/training'
import { compareNames } from '@/domain/requirements/manual-check'
import { classifyCourse, evaluateTrainingRequirement } from '@/domain/requirements/training-hours'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import {
  TRAINING_IMPORT_JOB_TYPE,
  TRAINING_IMPORT_SCHEDULE_KEY,
  trainingImportPayloadSchema,
} from './training-import-job'

const RECENT_IMPORTS = 10
const DAY_SECONDS = 86_400

type TrainingHoursRow = {
  readonly caregiverId: string
  readonly caregiverName: string | null
  readonly requirementName: string
  readonly completedMinutes: number
  readonly minimumMinutes: number
  readonly shortfallMinutes: number
}

export type TrainingOverview = {
  readonly hours: readonly TrainingHoursRow[]
  readonly unmatched: readonly UnmatchedTrainingAccount[]
  readonly linkableCaregivers: readonly LinkableCaregiver[]
  readonly uncountedCourses: readonly TrainingCourse[]
  readonly imports: readonly TrainingImportSummary[]
  readonly schedule: { readonly sourceRef: string; readonly nextOccurrenceAt: Date } | null
}

// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const getTrainingOverview: UseCase<Record<string, never>, TrainingOverview> = defineUseCase(
  'training.view',
  async ({ principal: { agencyId } }) => {
    const now = new Date()
    const [subjects, unmatched, linkable, courses, imports, schedule] = await Promise.all([
      findTrainingHoursSubjects(agencyId),
      findUnmatchedTrainingAccounts(agencyId),
      findLinkableCaregivers(agencyId),
      findTrainingCourses(agencyId),
      findRecentTrainingImports(agencyId, RECENT_IMPORTS),
      getScheduleByKey(agencyId, TRAINING_IMPORT_SCHEDULE_KEY),
    ])

    const hours = subjects.flatMap((subject) =>
      subject.requirements.flatMap((requirement): TrainingHoursRow[] => {
        const standing = evaluateTrainingRequirement(requirement, subject.completions, now)
        if (standing === null || standing.minimumMinutes === null) return []
        return [
          {
            caregiverId: subject.caregiverId,
            caregiverName: subject.caregiverName,
            requirementName: requirement.name,
            completedMinutes: standing.completedMinutes,
            minimumMinutes: standing.minimumMinutes,
            shortfallMinutes: standing.shortfallMinutes,
          },
        ]
      }),
    )
    hours.sort(
      (a, b) =>
        Number(b.shortfallMinutes > 0) - Number(a.shortfallMinutes > 0) ||
        compareNames(a.caregiverName, b.caregiverName) ||
        a.requirementName.localeCompare(b.requirementName),
    )

    return {
      hours,
      unmatched,
      linkableCaregivers: [...linkable].sort((a, b) => compareNames(a.caregiverName, b.caregiverName)),
      uncountedCourses: courses.filter((course) => classifyCourse(course.courseCode) === null),
      imports,
      schedule:
        schedule === null || (schedule.endsAt !== null && schedule.endsAt <= now)
          ? null
          : {
              sourceRef: trainingImportPayloadSchema.parse(schedule.payload).sourceRef,
              nextOccurrenceAt: schedule.nextOccurrenceAt,
            },
    }
  },
)

const linkTrainingAccountInputSchema = z.strictObject({
  caregiverId: z.string().trim().min(1),
  externalCaregiverId: z.string().trim().min(1),
})

export const linkTrainingAccount: UseCase<
  { readonly caregiverId: string; readonly externalCaregiverId: string },
  TrainingAccountLinkResult
> = defineUseCase('training.link', async ({ principal, input }) => {
  const { caregiverId, externalCaregiverId } = linkTrainingAccountInputSchema.parse(input)
  return linkTrainingPlatformId(principal.agencyId, caregiverId, externalCaregiverId, new Date(), principal.id)
})

// A remote path for a real adapter must fit; the mock applies its own stricter check.
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const scheduleTrainingImportInputSchema = z.strictObject({ sourceRef: z.string().trim() })

type ScheduleTrainingImportResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly reason: 'INVALID_SOURCE' }

/** Turns on the daily import; the first runs on the worker's next cycle. An existing schedule is not changed. */
export const scheduleTrainingImport: UseCase<{ readonly sourceRef: string }, ScheduleTrainingImportResult> =
  defineUseCase('trainingImport.schedule', async ({ principal, input }) => {
    const { sourceRef } = scheduleTrainingImportInputSchema.parse(input)
    if (!SOURCE_REF.test(sourceRef) || sourceRef.split('/').includes('..')) {
      return { ok: false, reason: 'INVALID_SOURCE' }
    }

    const { created } = await createSchedule({
      agencyId: principal.agencyId,
      key: TRAINING_IMPORT_SCHEDULE_KEY,
      jobType: TRAINING_IMPORT_JOB_TYPE,
      payload: { sourceRef },
      intervalSeconds: DAY_SECONDS,
      firstOccurrenceAt: new Date(),
    })
    return { ok: true, created }
  })
