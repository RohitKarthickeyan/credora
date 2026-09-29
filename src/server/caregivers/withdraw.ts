import 'server-only'
import type { z } from 'zod'
import { runInAuditedTransaction } from '@/db/audit'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import { withdrawCaregiverInputSchema } from '@/domain/pipeline/withdrawal'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

export type WithdrawCaregiverResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'ALREADY_WITHDRAWN' | 'ALREADY_ACTIVE' }

/**
 * Take a caregiver off the pipeline to terminal WITHDRAWN. The reason goes to the PipelineEvent,
 * never to the audit entry. Nothing else is cancelled: each job re-checks the stage when it runs
 * (ADR-079).
 */
export const withdrawCaregiver: UseCase<
  Readonly<Record<keyof z.input<typeof withdrawCaregiverInputSchema>, string>>,
  WithdrawCaregiverResult
> = defineUseCase('caregiver.withdraw', async ({ principal, input: raw }) => {
  const { caregiverId, reason } = withdrawCaregiverInputSchema.parse(raw)

  const result = await runInAuditedTransaction((tx) =>
    applyPipelineTransition(tx, principal.agencyId, {
      caregiverId,
      event: 'WITHDRAWAL_RECORDED',
      actorUserId: principal.id,
      reason,
    }),
  )

  if (result.ok) return { ok: true }
  if (result.refusal === 'ALREADY_APPLIED') return { ok: false, reason: 'ALREADY_WITHDRAWN' }
  if (result.refusal === 'TERMINAL_STAGE') return { ok: false, reason: 'ALREADY_ACTIVE' }
  throw new Error(`WITHDRAWAL_RECORDED has no edge from ${result.from}.`)
})
