import { z } from 'zod'
import type { AgentEvent } from '@/domain/conversation/events'

export const agentInputSchema = z.object({
  step: z.string().min(1),
  allowedEvents: z.array(z.enum(['answer', 'confirm', 'correct', 'question', 'unclear'])).min(1),
  status: z.string().min(1),
  history: z.array(z.object({ from: z.enum(['caregiver', 'agent']), text: z.string() })),
  text: z.string(),
})
export type AgentInput = z.infer<typeof agentInputSchema>

export interface AgentPort {
  interpret(input: AgentInput): Promise<AgentEvent>
}
