import { z } from 'zod'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

export const trainingRecordSchema = z.object({
  externalCaregiverId: z.string().min(1),
  courseCode: z.string().min(1),
  courseName: z.string().min(1),
  completedOn: z.iso.date(),
  minutes: z.int().nonnegative(),
})
export type TrainingRecord = z.infer<typeof trainingRecordSchema>

// Malformed CSV rows are reported in `rejected`, never silently dropped.
export const trainingImportSchema = z.object({
  sourceRef: z.string().min(1),
  records: z.array(trainingRecordSchema),
  rejected: z.array(z.object({ line: z.int().positive(), reason: z.string().min(1) })),
})
export type TrainingImport = z.infer<typeof trainingImportSchema>

export const importTrainingInputSchema = z.object({
  agencyId: z.uuid(),
  sourceRef: z.string().min(1),
})
export type ImportTrainingInput = z.infer<typeof importTrainingInputSchema>

export const listCompletionsInputSchema = z.object({
  agencyId: z.uuid(),
  externalCaregiverId: z.string().min(1),
  since: z.iso.date().nullable(),
})
export type ListCompletionsInput = z.infer<typeof listCompletionsInputSchema>

export interface TrainingPort {
  importBatch(input: ImportTrainingInput): Promise<TrainingImport>
  listCompletions(input: ListCompletionsInput): Promise<readonly TrainingRecord[]>
}
