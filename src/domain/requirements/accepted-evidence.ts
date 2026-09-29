import type { AcceptedEvidence } from './template'

// Any one option satisfies the requirement ("a PPD result or a chest X-ray"). The kind must
// match as well as the key: the option says what the evidence is.
export function isAcceptedEvidence(
  options: readonly AcceptedEvidence[],
  candidate: Pick<AcceptedEvidence, 'kind' | 'evidenceKey'>,
): boolean {
  return options.some(
    (option) => option.kind === candidate.kind && option.evidenceKey === candidate.evidenceKey,
  )
}
