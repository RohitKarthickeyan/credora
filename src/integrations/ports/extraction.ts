import { z } from 'zod'
import { storageKeySchema } from './storage'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

// Closed, open to addition: adding a name is a one-line change; removing one breaks a consumer
// and needs an ADR.
export const EXTRACTED_FIELD_NAMES = [
  'fullName',
  'dateOfBirth',
  'address',
  'documentNumber',
  'issuer',
  'issueDate',
  'expiryDate',
  'completionDate',
  'trainingMinutes',
] as const
export const extractedFieldNameSchema = z.enum(EXTRACTED_FIELD_NAMES)
export type ExtractedFieldName = z.infer<typeof extractedFieldNameSchema>

export const extractionInputSchema = z.object({
  agencyId: z.uuid(),
  caregiverId: z.uuid(),
  storageKey: storageKeySchema,
})
export type ExtractionInput = z.infer<typeof extractionInputSchema>

export const extractedFieldSchema = z.object({
  name: extractedFieldNameSchema,
  value: z.string(),
  confidence: z.number().min(0).max(1),
})
export type ExtractedField = z.infer<typeof extractedFieldSchema>

export const extractionResultSchema = z.object({
  fields: z.array(extractedFieldSchema),
  text: z.string(),
  confidence: z.number().min(0).max(1),
})
export type ExtractionResult = z.infer<typeof extractionResultSchema>

export interface ExtractionPort {
  extract(input: ExtractionInput): Promise<ExtractionResult>
}
