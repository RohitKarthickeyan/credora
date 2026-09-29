import type { EnvelopeStatus } from '@/domain/documents/envelope'
import type { InviteStatus } from '@/domain/pipeline/invite'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { StatusPresentation } from '@/ui/status'

// EXCEPTION reads as "Needs attention": DOMAIN.md fixes the code name, not the words a
// caregiver on a phone is shown.
export const REQUIREMENT_STATUS_PRESENTATION: Record<InstanceStatus, StatusPresentation> = {
  NOT_STARTED: { tone: 'neutral', label: 'Not started', glyph: 'dot' },
  PENDING: { tone: 'progress', label: 'In progress', glyph: 'half' },
  IN_REVIEW: { tone: 'info', label: 'In review', glyph: 'search' },
  SATISFIED: { tone: 'success', label: 'Satisfied', glyph: 'check' },
  EXCEPTION: { tone: 'danger', label: 'Needs attention', glyph: 'alert' },
  WAIVED: { tone: 'muted', label: 'Waived', glyph: 'slash' },
  EXPIRED: { tone: 'warning', label: 'Expired', glyph: 'clock' },
}

export const PIPELINE_STAGE_PRESENTATION: Record<PipelineStage, StatusPresentation> = {
  INVITED: { tone: 'neutral', label: 'Invited', glyph: 'dot' },
  INTAKE: { tone: 'progress', label: 'Intake', glyph: 'half' },
  SIGNING: { tone: 'progress', label: 'Signing', glyph: 'half' },
  DOCUMENT_REVIEW: { tone: 'info', label: 'Document review', glyph: 'search' },
  VERIFICATION: { tone: 'info', label: 'Verification', glyph: 'search' },
  CLEARANCE: { tone: 'info', label: 'Clearance', glyph: 'search' },
  SYNCING: { tone: 'progress', label: 'Syncing', glyph: 'half' },
  ACTIVE: { tone: 'success', label: 'Active', glyph: 'check' },
  WITHDRAWN: { tone: 'muted', label: 'Withdrawn', glyph: 'slash' },
}

export const INVITE_STATUS_PRESENTATION: Record<InviteStatus, StatusPresentation> = {
  QUEUED: { tone: 'neutral', label: 'Waiting to send', glyph: 'clock' },
  SENT: { tone: 'success', label: 'Sent', glyph: 'check' },
  REJECTED: { tone: 'danger', label: 'Not delivered', glyph: 'alert' },
  CANCELLED: { tone: 'muted', label: 'Cancelled', glyph: 'slash' },
}

export const ENVELOPE_STATUS_PRESENTATION: Record<EnvelopeStatus, StatusPresentation> = {
  PREPARING: { tone: 'progress', label: 'Preparing', glyph: 'half' },
  SENT: { tone: 'info', label: 'Out for signing', glyph: 'search' },
  SIGNED: { tone: 'success', label: 'Signed', glyph: 'check' },
  DECLINED: { tone: 'danger', label: 'Declined', glyph: 'alert' },
  VOIDED: { tone: 'muted', label: 'Voided', glyph: 'slash' },
}
