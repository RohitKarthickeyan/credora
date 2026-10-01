import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { JUDGE_CRITERIA, formatReason } from './criteria'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { judgeInputSchema, judgeResultSchema, judgeVerdictSchema } from '@/integrations/ports/judge'
import type { JudgeInput, JudgePort, JudgeResult } from '@/integrations/ports/judge'
import { OPENAI_MODEL, createOpenAIClient } from '../openai-client'

// The demo's judge (ADR-165): the claude adapter's criteria, schema and grounding rule on the
// Responses API.
const judgeModelOutputSchema = z.object({
  verdict: judgeVerdictSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.object({ quote: z.string().min(1), finding: z.string().min(1) })).min(1),
})
type JudgeModelOutput = z.infer<typeof judgeModelOutputSchema>

function retryAfterMs(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after') ?? Number.NaN)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

function toVendorUnavailable(error: unknown): never {
  if (error instanceof OpenAI.APIConnectionError) {
    throw new VendorUnavailableError('judge', error.message)
  }
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.InternalServerError) {
    throw new VendorUnavailableError('judge', error.message, retryAfterMs(error.headers))
  }
  throw error
}

function parseModelOutput(response: OpenAI.Responses.Response): JudgeModelOutput | null {
  let json: unknown
  try {
    json = JSON.parse(response.output_text)
  } catch {
    return null
  }
  const parsed = judgeModelOutputSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

function refused(response: OpenAI.Responses.Response): boolean {
  return response.output.some(
    (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
  )
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function toResult(input: JudgeInput, response: OpenAI.Responses.Response): JudgeResult {
  const uncertain = (finding: string): JudgeResult => ({
    verdict: 'UNCERTAIN',
    confidence: 0,
    reasons: [formatReason(input.requirementDescription, finding)],
    modelVersion: response.model,
  })

  if (refused(response)) return uncertain('the model declined to assess this record')
  if (response.status !== 'completed') return uncertain('the model did not complete its output')

  const output = parseModelOutput(response)
  if (output === null) return uncertain("the model's output was unparseable")

  const sources = [input.requirementDescription, input.issuerName ?? '', input.documentText].map(normalise)
  const ungrounded = output.reasons.filter(
    ({ quote }) => !sources.some((source) => source.includes(normalise(quote))),
  )
  const reasons = output.reasons.map(({ quote, finding }) => formatReason(quote, finding))

  if (ungrounded.length > 0) {
    return {
      verdict: 'UNCERTAIN',
      confidence: output.confidence,
      reasons: [
        ...reasons,
        ...ungrounded.map(({ quote }) => formatReason(quote, 'this quote does not appear in the record')),
      ],
      modelVersion: response.model,
    }
  }

  return { verdict: output.verdict, confidence: output.confidence, reasons, modelVersion: response.model }
}

export function createOpenAIJudge(client: OpenAI = createOpenAIClient()): JudgePort {
  return {
    async assess(input) {
      const parsed = judgeInputSchema.parse(input)

      const response = await client.responses
        .create({
          model: OPENAI_MODEL,
          reasoning: { effort: 'low' },
          instructions: JUDGE_CRITERIA,
          input:
            `<requirement>${parsed.requirementDescription}</requirement>\n` +
            `<issuer_name>${parsed.issuerName ?? 'none'}</issuer_name>\n` +
            `<document_text>${parsed.documentText}</document_text>`,
          text: { format: zodTextFormat(judgeModelOutputSchema, 'judge_assessment') },
        })
        .catch(toVendorUnavailable)

      return judgeResultSchema.parse(toResult(parsed, response))
    },
  }
}
