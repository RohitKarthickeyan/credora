import { z } from 'zod'
import { REQUIREMENT_LAYERS, layerOf, templateScopeSchema } from './scope'

// The four lists below are the source of truth for the Prisma enums `RequirementType`,
// `EvidenceKind`, `ValidityRule` and `RenewalRule`, which mirror them because src/domain may
// not import src/db (ARCHITECTURE.md § Layers). Keep each pair in step.
export const REQUIREMENT_TYPES = ['FORM', 'DOCUMENT', 'CHECK', 'TRAINING', 'ATTESTATION'] as const

// Member for member the arms of `RequirementInstance 1─n Evidence → UploadedDocument |
// SignedDocument | CheckResult | TrainingRecord | Attestation` (DATA-MODEL.md § Core entities).
export const EVIDENCE_KINDS = [
  'UPLOADED_DOCUMENT',
  'SIGNED_DOCUMENT',
  'CHECK_RESULT',
  'TRAINING_RECORD',
  'ATTESTATION',
] as const

export const VALIDITY_RULES = ['NEVER_EXPIRES', 'FROM_EVIDENCE', 'FIXED_PERIOD'] as const
export const RENEWAL_RULES = ['NONE', 'ON_EXPIRY', 'ANNUAL'] as const

export const REQUIREMENT_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

const KEY_ERROR =
  'A requirement key is SCREAMING_SNAKE_CASE, e.g. TB_SCREENING. It is the identity a narrower ' +
  'template overrides a broader one by, so it must be typed the same way everywhere.'

const acceptedEvidenceSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    evidenceKey: z.string().regex(REQUIREMENT_KEY_PATTERN, { error: KEY_ERROR }),
    label: z.string().min(1),
  })
  .readonly()

export const requirementTemplateSchema = z
  .object({
    key: z.string().regex(REQUIREMENT_KEY_PATTERN, { error: KEY_ERROR }),
    version: z.int().positive(),
    scope: templateScopeSchema,
    layer: z.enum(REQUIREMENT_LAYERS),
    name: z.string().min(1),
    // Sent verbatim to the judge (SECURITY.md § LLM provider constraints): it describes the
    // requirement, never a caregiver.
    description: z.string().min(1),
    type: z.enum(REQUIREMENT_TYPES),
    acceptedEvidence: z
      .array(acceptedEvidenceSchema)
      .min(1, {
        error:
          'A requirement nobody can satisfy is not a requirement: name at least one accepted ' +
          'evidence option.',
      })
      .refine(
        (options) => new Set(options.map((option) => option.evidenceKey)).size === options.length,
        {
          error:
            'Two accepted evidence options share an evidenceKey. T-060 emits one document per ' +
            'option and T-074 judges against the option that was uploaded; a duplicate slug ' +
            'makes both ambiguous.',
        },
      ),
    validityRule: z.enum(VALIDITY_RULES),
    validityMonths: z.int().positive().nullable(),
    renewalRule: z.enum(RENEWAL_RULES),
    blocksClearance: z.boolean().default(true),
    manualOnly: z.boolean().default(false),
    manualOnlyReason: z.string().nullable(),
    // The annual minimum in whole minutes (CONVENTIONS: hours are integer minutes).
    minimumMinutes: z.int().positive().nullable().default(null),
    retiredAt: z.date().nullable(),
  })
  .superRefine((template, ctx) => {
    if (template.layer !== layerOf(template.scope)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layer'],
        message:
          `layer must be ${layerOf(template.scope)}, the narrowest present axis of the scope. ` +
          'The label is derived, not asserted, so the two cannot disagree; the database says ' +
          'the same thing in RequirementTemplate_layer_matches_scope.',
      })
    }

    if ((template.validityRule === 'FIXED_PERIOD') !== (template.validityMonths !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['validityMonths'],
        message:
          'validityMonths exists exactly when validityRule is FIXED_PERIOD. A period on a rule ' +
          'that does not use one is a number nothing reads; a FIXED_PERIOD without one has no ' +
          'expiry to compute.',
      })
    }

    if (template.manualOnly && (template.manualOnlyReason ?? '').trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['manualOnlyReason'],
        message:
          'A step kept away from automation must name the regulation that keeps it there ' +
          '(SECURITY.md § Regulatory constraints that shape code), so the exception queue can ' +
          'show it.',
      })
    }

    if (template.minimumMinutes !== null && template.type !== 'TRAINING') {
      ctx.addIssue({
        code: 'custom',
        path: ['minimumMinutes'],
        message:
          'minimumMinutes is the annual training minimum, so only a TRAINING rule may carry one. ' +
          'On any other type it is a number nothing reads; the database says the same thing in ' +
          'RequirementTemplate_minimum_minutes.',
      })
    }
  })

export type RequirementType = (typeof REQUIREMENT_TYPES)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
export type AcceptedEvidence = z.infer<typeof acceptedEvidenceSchema>
export type RequirementTemplate = z.infer<typeof requirementTemplateSchema>
