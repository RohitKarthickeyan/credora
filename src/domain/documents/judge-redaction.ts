export type JudgeInputText = {
  readonly requirementDescription: string
  readonly issuerName: string | null
  readonly documentText: string
}

const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
  'sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

const EMAIL = /\S+@\S+\.\S+/g
const DATES = [
  new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'gi'),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}([/-])\d{1,2}\1(?:\d{4}|\d{2})\b/g,
]
const NUMBER_RUN = /\d[\d .\-/()]*\d/g
const MIN_NUMBER_DIGITS = 5
const MIN_TERM_LENGTH = 2

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termPattern(term: string): RegExp {
  const body = term.split(/\s+/).map(escapeRegExp).join('\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
}

function redactText(text: string, patterns: readonly RegExp[]): string {
  let redacted = patterns.reduce((out, pattern) => out.replace(pattern, '[REDACTED]'), text)
  redacted = redacted.replace(EMAIL, '[EMAIL]')
  redacted = DATES.reduce((out, pattern) => out.replace(pattern, '[DATE]'), redacted)
  return redacted.replace(NUMBER_RUN, (run) =>
    (run.match(/\d/g)?.length ?? 0) >= MIN_NUMBER_DIGITS ? '[NUMBER]' : run,
  )
}

/**
 * Everything leaving for the judge passes through here (SECURITY.md § LLM provider constraints,
 * ADR-099). The requirement description is redacted too: an admin can paste caregiver data
 * into it (T-030 Flag 9).
 */
export function redactForJudge(input: JudgeInputText, knownTerms: readonly string[]): JudgeInputText {
  const patterns = knownTerms
    .map((term) => term.trim())
    .filter((term) => term.length >= MIN_TERM_LENGTH)
    .sort((a, b) => b.length - a.length)
    .map(termPattern)

  return {
    requirementDescription: redactText(input.requirementDescription, patterns),
    issuerName: input.issuerName === null ? null : redactText(input.issuerName, patterns),
    documentText: redactText(input.documentText, patterns),
  }
}
