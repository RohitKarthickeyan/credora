import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { agentEventSchema, type AgentEvent } from '@/domain/conversation/events'
import { TEXT_INTAKE_FIELDS } from '@/domain/conversation/step'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { agentInputSchema, type AgentInput, type AgentPort } from '@/integrations/ports/agent'
import { OPENAI_MODEL, createOpenAIClient } from '../openai-client'
import { AGENT_FAQ } from './faq'

const UNCLEAR: AgentEvent = { kind: 'unclear' }

// Structured Outputs needs an object root with every property required, so the event union
// is sent flat (unused slots null) and mapped back to an AgentEvent.
const wireSchema = z.object({
  kind: z.enum(['answer', 'confirm', 'correct', 'question', 'unclear']),
  field: z.enum([...TEXT_INTAKE_FIELDS, 'legalName']).nullable(),
  text: z.string().nullable(),
  address: z
    .object({ line1: z.string(), line2: z.string().nullable(), city: z.string(), state: z.string(), zip: z.string() })
    .nullable(),
})
type Wire = z.infer<typeof wireSchema>

function wireValue(wire: Wire): unknown {
  if (wire.address === null) return wire.text
  const { line2, ...rest } = wire.address
  return line2 === null ? rest : { ...rest, line2 }
}

function toEvent(wire: Wire): unknown {
  switch (wire.kind) {
    case 'answer':
      return { kind: 'answer', value: wireValue(wire) }
    case 'correct':
      return { kind: 'correct', field: wire.field, value: wireValue(wire) }
    case 'question':
      return { kind: 'question', answer: wire.text }
    default:
      return { kind: wire.kind }
  }
}

function systemPrompt(input: AgentInput): string {
  return [
    'You read one text message from a home care job applicant and return exactly one event.',
    `Allowed events: ${input.allowedEvents.join(', ')}.`,
    '`answer` gives the value just asked for (dates as YYYY-MM-DD, sex as F/M/X, address as parts).',
    '`confirm` means they agree the details are right.',
    '`correct` names the field to change and its new value.',
    '`question` is anything they ask; answer it in at most two short sentences using only the FAQ and their status, or null if the FAQ does not cover it.',
    '`unclear` for anything else. Never invent facts.',
    `FAQ:\n${AGENT_FAQ}`,
    `Status: ${input.status}`,
    `Just asked: ${input.step}`,
    `Conversation so far:\n${input.history.map((turn) => `${turn.from}: ${turn.text}`).join('\n')}`,
  ].join('\n\n')
}

function retryAfterMs(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after') ?? Number.NaN)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

function toVendorUnavailable(error: unknown): never {
  if (error instanceof OpenAI.APIConnectionError) {
    throw new VendorUnavailableError('agent', error.message)
  }
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.InternalServerError) {
    throw new VendorUnavailableError('agent', error.message, retryAfterMs(error.headers))
  }
  throw error
}

function parseEvent(response: OpenAI.Responses.Response): AgentEvent | null {
  if (response.status !== 'completed') return null
  let json: unknown
  try {
    json = JSON.parse(response.output_text)
  } catch {
    return null
  }
  const wire = wireSchema.safeParse(json)
  if (!wire.success) return null
  const event = agentEventSchema.safeParse(toEvent(wire.data))
  return event.success ? event.data : null
}

export function createOpenAIAgent(client: OpenAI = createOpenAIClient()): AgentPort {
  return {
    async interpret(input) {
      const parsed = agentInputSchema.parse(input)

      const response = await client.responses
        .create({
          model: OPENAI_MODEL,
          reasoning: { effort: 'low' },
          instructions: systemPrompt(parsed),
          input: parsed.text,
          text: { format: zodTextFormat(wireSchema, 'agent_event') },
        })
        .catch(toVendorUnavailable)

      const event = parseEvent(response)
      return event !== null && parsed.allowedEvents.includes(event.kind) ? event : UNCLEAR
    },
  }
}
