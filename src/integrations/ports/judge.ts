import { z } from 'zod'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; no result carries a time read from the clock; adapters parse each
// input with its schema first. The one agentic port (AGENTIC-TASKS.md § Permitted: 1).

export const judgeVerdictSchema = z.enum(['VALID', 'INVALID', 'UNCERTAIN'])
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>

// No agencyId, caregiverId or name, and `.strict()`: this input reaches a third party's model,
// so it has nowhere to put an identifier (AGENTIC-TASKS.md § Constraints, redaction).
export const judgeInputSchema = z
  .object({
    requirementDescription: z.string().min(1),
    documentText: z.string().min(1),
    issuerName: z.string().min(1).nullable(),
  })
  .strict()
export type JudgeInput = z.infer<typeof judgeInputSchema>

// modelVersion is required so an accidental real call is visible in the logged decision; the
// mock reports 'mock'.
export const judgeResultSchema = z.object({
  verdict: judgeVerdictSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1),
  modelVersion: z.string().min(1),
})
export type JudgeResult = z.infer<typeof judgeResultSchema>

export interface JudgePort {
  assess(input: JudgeInput): Promise<JudgeResult>
}
