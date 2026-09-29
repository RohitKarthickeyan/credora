import type { NormalisedFields } from '@/domain/documents/extraction'
import { normalizeName, normalizeNameForMatch, type PersonName } from '@/domain/validation/name'

export type IntakeIdentity = {
  readonly legalName: PersonName | null
  readonly otherNames: readonly string[]
  readonly dateOfBirth: string | null
}

// The source of truth for the Prisma enum IdentityOutcome; keep the two in step.
export const IDENTITY_OUTCOMES = [
  'AGREES',
  'AGREES_WITH_OTHER_NAME',
  'DIFFERS',
  'UNREADABLE',
  'NOT_PRINTED',
  'NOT_ON_INTAKE',
] as const
export type IdentityOutcome = (typeof IDENTITY_OUTCOMES)[number]

export type IdentityFinding = {
  readonly field: 'fullName' | 'dateOfBirth'
  readonly outcome: IdentityOutcome
}

export type IdentityMatch = {
  readonly matched: boolean
  readonly findings: readonly IdentityFinding[]
}

type Candidate = { first: string[]; middle: string[]; last: string[] }

function tokens(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token.length > 0)
}

function legalCandidate(name: PersonName): Candidate {
  const normalized = normalizeNameForMatch(name)

  return {
    first: tokens(normalized.first),
    middle: tokens(normalized.middle),
    last: tokens(normalized.last),
  }
}

// A one-word other name is read as a former last name (OPEN-QUESTIONS 148): the intake label asks for
// "other names … including maiden names".
function otherCandidates(legal: Candidate, otherNames: readonly string[]): Candidate[] {
  return otherNames.flatMap((entry) => {
    const t = tokens(entry)
    const [first] = t
    const last = t[t.length - 1]

    if (first === undefined || last === undefined) {
      return []
    }

    if (t.length === 1) {
      return [{ first: legal.first, middle: legal.middle, last: [last] }]
    }

    return [{ first: [first], middle: t.slice(1, -1), last: [last] }]
  })
}

function tokensAgree(a: string, b: string): boolean {
  return a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))
}

function middleAgrees(document: readonly string[], intake: readonly string[]): boolean {
  const shared = Math.min(document.length, intake.length)

  for (let i = 0; i < shared; i += 1) {
    if (!tokensAgree(document[i] ?? '', intake[i] ?? '')) {
      return false
    }
  }

  return true
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i])
}

// The document's first/middle/last split is positional (T-071) and ignored; intake's parts
// were typed by the caregiver and carry the structure (ADR-091).
function agrees(document: readonly string[], candidate: Candidate): boolean {
  const { first, middle, last } = candidate
  const lastStart = document.length - last.length

  return (
    document.length >= first.length + last.length &&
    sameTokens(document.slice(0, first.length), first) &&
    sameTokens(document.slice(lastStart), last) &&
    middleAgrees(document.slice(first.length, lastStart), middle)
  )
}

function nameOutcome(intake: IntakeIdentity, fields: NormalisedFields): IdentityOutcome {
  const printed = fields.fullName

  if (printed === undefined) {
    return 'NOT_PRINTED'
  }

  if (printed.value === null) {
    return 'UNREADABLE'
  }

  if (intake.legalName === null) {
    return 'NOT_ON_INTAKE'
  }

  const { first, middle, last } = printed.value
  const document = tokens([first, middle, last].filter((part) => part !== undefined).join(' '))
  const legal = legalCandidate(intake.legalName)

  if (agrees(document, legal)) {
    return 'AGREES'
  }

  if (otherCandidates(legal, intake.otherNames).some((candidate) => agrees(document, candidate))) {
    return 'AGREES_WITH_OTHER_NAME'
  }

  return 'DIFFERS'
}

function dateOfBirthOutcome(intake: IntakeIdentity, fields: NormalisedFields): IdentityOutcome {
  const printed = fields.dateOfBirth

  if (printed === undefined) {
    return 'NOT_PRINTED'
  }

  if (printed.value === null) {
    return 'UNREADABLE'
  }

  if (intake.dateOfBirth === null) {
    return 'NOT_ON_INTAKE'
  }

  return printed.value === intake.dateOfBirth ? 'AGREES' : 'DIFFERS'
}

/**
 * Matches one document against intake alone, never against other documents (ADR-090).
 * Name and date of birth only: ID numbers are not compared in V1 (ADR-092, OPEN-QUESTIONS 103).
 */
export function matchIdentity(intake: IntakeIdentity, fields: NormalisedFields): IdentityMatch {
  const name = nameOutcome(intake, fields)
  const dateOfBirth = dateOfBirthOutcome(intake, fields)

  return {
    matched:
      (name === 'AGREES' || name === 'AGREES_WITH_OTHER_NAME') &&
      (dateOfBirth === 'AGREES' || dateOfBirth === 'NOT_PRINTED'),
    findings: [
      { field: 'fullName', outcome: name },
      { field: 'dateOfBirth', outcome: dateOfBirth },
    ],
  }
}
