import type { AgentEvent } from '@/domain/conversation/events'
import type { AgentPort } from '@/integrations/ports/agent'

const YES = /^(yes|y|yes it is|correct|that's right)[.!]?$/i
const DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/
const SEX = new Map([['f', 'F'], ['female', 'F'], ['m', 'M'], ['male', 'M'], ['x', 'X']])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ADDRESS = /^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5})$/

function parseAnswer(text: string): AgentEvent {
  const date = DATE.exec(text)
  if (date !== null) {
    const [, month = '', day = '', year = ''] = date
    return { kind: 'answer', value: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` }
  }
  const sex = SEX.get(text.toLowerCase())
  if (sex !== undefined) return { kind: 'answer', value: sex }
  if (EMAIL.test(text)) return { kind: 'answer', value: text }
  const address = ADDRESS.exec(text)
  if (address !== null) {
    const [, line1 = '', city = '', state = '', zip = ''] = address
    return { kind: 'answer', value: { line1, city, state: state.toUpperCase(), zip } }
  }
  return { kind: 'unclear' }
}

export function createMockAgent(): AgentPort {
  return {
    async interpret({ text, allowedEvents }) {
      const trimmed = text.trim()
      const event: AgentEvent = trimmed.endsWith('?')
        ? { kind: 'question', answer: null }
        : YES.test(trimmed)
          ? { kind: 'confirm' }
          : parseAnswer(trimmed)
      return allowedEvents.includes(event.kind) ? event : { kind: 'unclear' }
    },
  }
}
