import type { RequirementTemplate } from './template'

/**
 * A discriminated union rather than a boolean, so that the auto-accept rule (T-074) has to
 * branch on `kind`: there is nothing to truthily coerce and nothing to `!` away, and with an
 * exhaustive switch a forgotten arm is a compile error rather than an auto-accept. `reason` is
 * unreachable except through MANUAL_ONLY, so the exception queue always has the regulation.
 */
export type SatisfactionPath =
  | { readonly kind: 'AUTOMATED_ALLOWED' }
  | { readonly kind: 'MANUAL_ONLY'; readonly reason: string }

/**
 * The only sanctioned reader of `manualOnly` (SECURITY.md § Regulatory constraints that shape
 * code). No other field opens or closes the automated path.
 */
export function satisfactionPath(
  template: Pick<RequirementTemplate, 'manualOnly' | 'manualOnlyReason'>,
): SatisfactionPath {
  if (!template.manualOnly) return { kind: 'AUTOMATED_ALLOWED' }

  if (template.manualOnlyReason === null) {
    // Unreachable through any write path: requirementTemplateSchema rejects it and the
    // RequirementTemplate_manual_only_reason CHECK rejects it in the database. Failing here is
    // the fail-closed answer — the one thing this must never do is return AUTOMATED_ALLOWED.
    throw new Error(
      'A manualOnly template reached satisfactionPath with no manualOnlyReason. Such a row ' +
        'cannot be written, so the template did not come from the database.',
    )
  }

  return { kind: 'MANUAL_ONLY', reason: template.manualOnlyReason }
}
