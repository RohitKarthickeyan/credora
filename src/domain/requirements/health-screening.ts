import { z } from 'zod'
import {
  MEDICAL_SCREENING_OUTCOMES,
  type MedicalScreeningItem,
  type MedicalScreeningOutcome,
  medicalScreeningResultInputSchema,
} from '@/domain/medical/screening'
import type { InstanceStatus } from './instance-status'

// Template keys on one side, the medical store's items on the other: this map is the one place
// the two vocabularies meet.
export const HEALTH_SCREENING_ITEMS: Readonly<Record<string, MedicalScreeningItem>> = {
  PHYSICAL_EXAM: 'PHYSICAL_EXAM',
  TB_SCREENING: 'TB_SCREENING',
  IMMUNIZATION_RECORD: 'IMMUNISATION',
}

export function healthScreeningItemOf(templateKey: string): MedicalScreeningItem | null {
  if (!Object.hasOwn(HEALTH_SCREENING_ITEMS, templateKey)) return null
  return HEALTH_SCREENING_ITEMS[templateKey] ?? null
}

/**
 * Review rules on a clinic document's validity, never its clinical outcome, so an accepted health
 * screening document waits IN_REVIEW for the supervisor's recorded result.
 */
function acceptedDocumentStatus(templateKey: string): 'SATISFIED' | 'IN_REVIEW' {
  return healthScreeningItemOf(templateKey) === null ? 'SATISFIED' : 'IN_REVIEW'
}

export function awaitsHealthScreeningResult(instance: {
  readonly templateKey: string
  readonly status: InstanceStatus
}): boolean {
  return healthScreeningItemOf(instance.templateKey) !== null && instance.status === 'IN_REVIEW'
}

/**
 * The moves staff accept makes from EXCEPTION. A health screening passes through PENDING to reach
 * IN_REVIEW inside one transaction, because there is no EXCEPTION → IN_REVIEW edge.
 */
export function staffAcceptSteps(templateKey: string): readonly InstanceStatus[] {
  return acceptedDocumentStatus(templateKey) === 'IN_REVIEW' ? ['PENDING', 'IN_REVIEW'] : ['SATISFIED']
}

// A FAIL returns the requirement for a new result; the caregiver may upload again from EXCEPTION.
export function healthScreeningResultStatus(outcome: MedicalScreeningOutcome): 'SATISFIED' | 'EXCEPTION' {
  return outcome === 'PASS' ? 'SATISFIED' : 'EXCEPTION'
}

export const recordHealthScreeningResultInputSchema = z.strictObject({
  instanceId: z.uuid(),
  outcome: z.enum(MEDICAL_SCREENING_OUTCOMES),
  resultedOn: medicalScreeningResultInputSchema.shape.resultedOn,
})

export type HealthScreeningRefusal = 'NOT_AWAITING_RESULT'
