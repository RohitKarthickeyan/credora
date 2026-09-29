import type { AcceptedIssuerKind } from '@/domain/documents/accepted-issuer'

export const ACCEPTED_ISSUER_KIND_LABELS: Record<AcceptedIssuerKind, string> = {
  TRAINING_PROGRAM: 'Training program',
  CLINIC: 'Clinic',
  STATE_AGENCY: 'State agency',
}
