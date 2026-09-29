import { documentReviewCleared } from '@/domain/requirements/document-review'
import type { AuditedTx } from '../audit'
import { applyPipelineTransition } from './pipeline-transitions'
import { applyVerificationCompleted } from './verification'

/**
 * Fires DOCUMENT_REVIEW_CLEARED when documentReviewCleared holds, through applyPipelineTransition
 * only (ADR-073, ADR-111). A refusal (not in DOCUMENT_REVIEW, withdrawn, already moved) writes
 * nothing. Every writer of SATISFIED on a DOCUMENT instance calls this in its transaction.
 * It then tries VERIFICATION_COMPLETED (ADR-113), so a caregiver with nothing else outstanding
 * goes straight on to Clearance.
 */
export async function applyDocumentReviewCleared(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  actorUserId: string | null,
): Promise<void> {
  const rows = await tx.requirementInstance.findMany({
    where: { agencyId, caregiverId },
    select: { status: true, template: { select: { type: true, blocksClearance: true } } },
  })
  if (!documentReviewCleared(rows.map(({ status, template }) => ({ status, ...template })))) return

  await applyPipelineTransition(tx, agencyId, { caregiverId, event: 'DOCUMENT_REVIEW_CLEARED', actorUserId })
  await applyVerificationCompleted(tx, agencyId, caregiverId, actorUserId)
}
