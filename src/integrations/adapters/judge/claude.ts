import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { JUDGE_CRITERIA, formatReason } from './criteria'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { judgeInputSchema, judgeResultSchema, judgeVerdictSchema } from '@/integrations/ports/judge'
import type { JudgeInput, JudgePort, JudgeResult } from '@/integrations/ports/judge'
import { env } from '@/lib/env'

// No sampling parameters: this model rejects them (PLAN T-054 § Design 6). No refusal
// fallbacks: they would route PHI to a model outside the BAA.
export const JUDGE_MODEL = 'claude-opus-5'

const judgeModelOutputSchema = z.object({
  verdict: judgeVerdictSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.object({ quote: z.string().min(1), finding: z.string().min(1) })).min(1),
})
type JudgeModelOutput = z.infer<typeof judgeModelOutputSchema>

function defaultClient(): Anthropic {
  if (env.ANTHROPIC_API_KEY === undefined) {
    throw new Error('JUDGE_ADAPTER=claude needs ANTHROPIC_API_KEY to be set.')
  }
  // The job queue owns retries (INTEGRATIONS.md Rule 5).
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 })
}

function retryAfterMs(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after') ?? Number.NaN)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

function toVendorUnavailable(error: unknown): never {
  if (error instanceof Anthropic.APIConnectionError) {
    throw new VendorUnavailableError('judge', error.message)
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    throw new VendorUnavailableError('judge', error.message, retryAfterMs(error.headers))
  }
  throw error
}

// `messages.parse` throws on a truncated or refused text block instead of returning
// `parsed_output: null`, so the adapter calls `create` and parses the block itself.
function parseModelOutput(content: Anthropic.ContentBlock[]): JudgeModelOutput | null {
  const block = content.find((candidate): candidate is Anthropic.TextBlock => candidate.type === 'text')
  if (block === undefined) return null

  let json: unknown
  try {
    json = JSON.parse(block.text)
  } catch {
    return null
  }
  const parsed = judgeModelOutputSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function toResult(input: JudgeInput, response: Anthropic.Message): JudgeResult {
  const uncertain = (finding: string): JudgeResult => ({
    verdict: 'UNCERTAIN',
    confidence: 0,
    reasons: [formatReason(input.requirementDescription, finding)],
    modelVersion: response.model,
  })

  if (response.stop_reason === 'refusal') return uncertain('the model declined to assess this record')
  if (response.stop_reason === 'max_tokens') return uncertain("the model's output was truncated")

  const output = parseModelOutput(response.content)
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

export function createClaudeJudge(client: Anthropic = defaultClient()): JudgePort {
  return {
    async assess(input) {
      const parsed = judgeInputSchema.parse(input)

      const response = await client.messages
        .create({
          model: JUDGE_MODEL,
          max_tokens: 16000,
          system: JUDGE_CRITERIA,
          messages: [
            {
              role: 'user',
              content:
                `<requirement>${parsed.requirementDescription}</requirement>\n` +
                `<issuer_name>${parsed.issuerName ?? 'none'}</issuer_name>\n` +
                `<document_text>${parsed.documentText}</document_text>`,
            },
          ],
          output_config: { effort: 'medium', format: zodOutputFormat(judgeModelOutputSchema) },
        })
        .catch(toVendorUnavailable)

      return judgeResultSchema.parse(toResult(parsed, response))
    },
  }
}
