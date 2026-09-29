import { clearanceReadiness } from '@/domain/requirements/clearance'
import type { AuditedTx } from '../audit'
import { findClearanceSheet } from './clearance'
import { applyPipelineTransition } from './pipeline-transitions'

/**
 * Fires VERIFICATION_COMPLETED when clearanceReadiness is ready, through applyPipelineTransition
 * only (ADR-073, ADR-113). A refusal (not in VERIFICATION, withdrawn, already moved) writes
 * nothing. Every writer of SATISFIED calls this in its transaction, DOCUMENT writers through
 * applyDocumentReviewCleared.
 */
export async function applyVerificationCompleted(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  actorUserId: string | null,
): Promise<void> {
  const sheet = await findClearanceSheet(tx, agencyId, caregiverId)
  if (sheet === null) throw new Error(`Caregiver ${caregiverId} does not exist in agency ${agencyId}.`)
  if (!clearanceReadiness(sheet.requirements).ready) return

  await applyPipelineTransition(tx, agencyId, { caregiverId, event: 'VERIFICATION_COMPLETED', actorUserId })
}
