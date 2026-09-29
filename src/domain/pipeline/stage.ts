// The source of truth for the stage names. The Prisma enum `PipelineStage` mirrors this list,
// because src/domain may not import src/db (ARCHITECTURE.md § Layers); keep the two in
// step. The state machine is T-015's.
export const PIPELINE_STAGES = [
  'INVITED',
  'INTAKE',
  'SIGNING',
  'DOCUMENT_REVIEW',
  'VERIFICATION',
  'CLEARANCE',
  'SYNCING',
  'ACTIVE',
  'WITHDRAWN',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]
