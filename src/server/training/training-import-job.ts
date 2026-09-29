import 'server-only'
import { z } from 'zod'
import { recordTrainingImport } from '@/db/repositories/training'
import { defineJobHandler } from '@/integrations/queue/handler'
import { getPort } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'

export const TRAINING_IMPORT_JOB_TYPE = 'training.import'
export const TRAINING_IMPORT_SCHEDULE_KEY = 'training.import'

export const trainingImportPayloadSchema = z.strictObject({ sourceRef: z.string().min(1) })
type TrainingImportPayload = z.infer<typeof trainingImportPayloadSchema>

// No human actor (OPEN-QUESTIONS 21): repositories under runAsSystem, never a guarded use case.
// A missing export throws and is retried; the schedule's next daily occurrence tries again.
export const trainingImportJob = defineJobHandler<TrainingImportPayload>({
  type: TRAINING_IMPORT_JOB_TYPE,
  schema: trainingImportPayloadSchema,
  run: (payload, { agencyId, now }) =>
    runAsSystem(async () => {
      const batch = await getPort('training').importBatch({ agencyId, sourceRef: payload.sourceRef })
      await recordTrainingImport(agencyId, batch, now)
      return { status: 'ok' }
    }),
})
