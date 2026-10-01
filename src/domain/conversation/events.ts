import { z } from 'zod'
import { TEXT_INTAKE_FIELDS, type ConversationStep } from './step'

const question = z.object({ kind: z.literal('question'), answer: z.string().min(1).nullable() })
const unclear = z.object({ kind: z.literal('unclear') })

const addressAnswer = z.object({ line1: z.string(), line2: z.string().optional(), city: z.string(), state: z.string(), zip: z.string() })

export const agentEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), value: z.union([z.string(), addressAnswer]) }),
  z.object({ kind: z.literal('confirm') }),
  z.object({ kind: z.literal('correct'), field: z.enum([...TEXT_INTAKE_FIELDS, 'legalName']), value: z.union([z.string(), addressAnswer]) }),
  question,
  unclear,
])
export type AgentEvent = z.infer<typeof agentEventSchema>

type AgentEventKind = AgentEvent['kind']

export function eventKindsFor(step: ConversationStep): readonly AgentEventKind[] {
  switch (step.kind) {
    case 'ASK_FIELD':
      return step.field === 'ssn' ? ['question', 'unclear'] : ['answer', 'question', 'unclear']
    case 'CONFIRM_INTAKE':
      return ['confirm', 'correct', 'question', 'unclear']
    default:
      return ['question', 'unclear']
  }
}
