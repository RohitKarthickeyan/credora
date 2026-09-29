import type { JudgeVerdict } from '@/domain/documents/judge-review'
import type { IdentityOutcome } from '@/domain/identity/match'

export const IDENTITY_OUTCOME_COPY: Record<IdentityOutcome, string> = {
  AGREES: 'agrees',
  AGREES_WITH_OTHER_NAME: 'agrees with another name on file',
  DIFFERS: 'differs',
  UNREADABLE: 'printed but unreadable',
  NOT_PRINTED: 'not on the document',
  NOT_ON_INTAKE: 'not on intake',
}

export const VERDICT_COPY: Record<JudgeVerdict, string> = {
  VALID: 'Valid',
  INVALID: 'Invalid',
  UNCERTAIN: 'Uncertain',
}
