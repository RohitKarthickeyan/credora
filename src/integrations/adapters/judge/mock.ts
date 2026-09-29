import { formatReason } from './criteria'
import { judgeInputSchema } from '@/integrations/ports/judge'
import type { JudgePort, JudgeResult, JudgeVerdict } from '@/integrations/ports/judge'

const NOT_GENUINE_MARKERS = ['void', 'sample', 'specimen', 'not valid']

const CREDENTIAL_KINDS: Readonly<Record<string, readonly string[]>> = {
  HHA: ['home health aide', 'hha'],
  PCA: ['personal care aide', 'pca'],
  CNA: ['nursing assistant', 'cna'],
  TB: ['tuberculosis', 'tb', 'ppd', 'quantiferon', 'igra'],
  PHYSICAL: ['physical exam', 'physical examination', 'medical examination', 'health assessment'],
  IMMUNIZATION: ['immunization', 'immunisation', 'vaccination', 'vaccine', 'mmr', 'titer', 'influenza'],
  CPR: ['cpr', 'cardiopulmonary resuscitation', 'bls', 'basic life support'],
}

const ISSUER_TERMS = [
  'program',
  'training',
  'school',
  'institute',
  'college',
  'clinic',
  'hospital',
  'medical',
  'health',
  'laboratory',
  'department',
  'state',
  'agency',
  'association',
  'red cross',
]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The first term found as a whole word, as it is written in `text`. */
function findTerm(text: string, terms: readonly string[]): string | null {
  for (const term of terms) {
    const match = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').exec(text)
    if (match !== null) return match[0]
  }
  return null
}

function result(verdict: JudgeVerdict, confidence: number, reasons: string[]): JudgeResult {
  return { verdict, confidence, reasons, modelVersion: 'mock' }
}

export function createMockJudge(): JudgePort {
  return {
    async assess(input) {
      const { requirementDescription, documentText, issuerName } = judgeInputSchema.parse(input)

      const marker = findTerm(documentText, NOT_GENUINE_MARKERS)
      if (marker !== null) {
        return result('INVALID', 0.95, [formatReason(marker, 'the record is marked as not genuine')])
      }

      const kind = Object.values(CREDENTIAL_KINDS)
        .map((terms) => ({ terms, requirementTerm: findTerm(requirementDescription, terms) }))
        .find(({ requirementTerm }) => requirementTerm !== null)
      if (kind === undefined || kind.requirementTerm === null) {
        return result('UNCERTAIN', 0.4, [
          formatReason(requirementDescription, 'the requirement names no known credential kind'),
        ])
      }

      const documentTerm = findTerm(documentText, kind.terms)
      if (documentTerm === null) {
        return result('INVALID', 0.85, [
          formatReason(kind.requirementTerm, 'the document is not this kind of record'),
        ])
      }

      const issuerTerm = findTerm(issuerName ?? documentText, ISSUER_TERMS)
      if (issuerTerm === null) {
        return result('UNCERTAIN', 0.5, [
          issuerName === null
            ? formatReason(documentTerm, 'the record names no issuer')
            : formatReason(issuerName, 'the issuer is not a recognisable program, clinic or agency'),
        ])
      }

      return result('VALID', 0.9, [
        formatReason(documentTerm, 'the document is the kind of record the requirement describes'),
        formatReason(issuerTerm, 'the issuer is a recognisable program, clinic or agency'),
      ])
    },
  }
}
