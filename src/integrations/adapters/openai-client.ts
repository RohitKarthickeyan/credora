import OpenAI from 'openai'
import { env } from '@/lib/env'

export const OPENAI_MODEL = 'gpt-5-mini'

export function createOpenAIClient(): OpenAI {
  if (env.OPENAI_API_KEY === undefined) {
    throw new Error('An openai adapter (AGENT_ADAPTER or JUDGE_ADAPTER) needs OPENAI_API_KEY to be set.')
  }
  // The job queue owns retries (INTEGRATIONS.md Rule 5).
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 })
}
