import type { PipelineEventType, TransitionResult } from '@/domain/pipeline/transitions'
import { transition } from '@/domain/pipeline/transitions'
import { type AuditedTx, writeAuditEntry } from '../audit'

type ApplyTransitionInput = {
  readonly caregiverId: string
  readonly event: PipelineEventType
  readonly actorUserId: string | null
  readonly reason?: string
}

/**
 * The only writer of `Caregiver.stage` (T-015 invariants 1 and 2); T-100, T-111, T-124 and T-041
 * call this. An `ok` move writes the stage, one PipelineEvent and one EDIT audit entry on `stage`
 * in the caller's transaction; a refusal, ALREADY_APPLIED included, writes nothing.
 */
export async function applyPipelineTransition(
  tx: AuditedTx,
  agencyId: string,
  input: ApplyTransitionInput,
): Promise<TransitionResult> {
  const caregiver = await tx.caregiver.findFirst({
    where: { id: input.caregiverId, agencyId },
    select: { stage: true },
  })
  if (caregiver === null) {
    throw new Error(`Caregiver ${input.caregiverId} does not exist in agency ${agencyId}.`)
  }

  const result = transition(caregiver.stage, input.event)
  if (!result.ok) return result

  const { count } = await tx.caregiver.updateMany({
    where: { id: input.caregiverId, agencyId, stage: result.from },
    data: { stage: result.to },
  })
  if (count === 0) {
    throw new Error(`Caregiver ${input.caregiverId} left ${result.from} during the transition.`)
  }

  await tx.pipelineEvent.create({
    data: {
      agencyId,
      caregiverId: input.caregiverId,
      fromStage: result.from,
      toStage: result.to,
      event: result.event,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
    },
  })
  await writeAuditEntry(tx, {
    agencyId,
    action: 'EDIT',
    entityType: 'CAREGIVER',
    entityId: input.caregiverId,
    fieldName: 'stage',
  })
  return result
}
