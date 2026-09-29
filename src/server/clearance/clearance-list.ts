import 'server-only'
import { findPipelineBoardRows } from '@/db/repositories/pipeline-board'
import { BOARD_STAGES } from '@/domain/pipeline/board'
import type { PipelineStage } from '@/domain/pipeline/stage'
import { type ClearanceReadiness, clearanceReadiness } from '@/domain/requirements/clearance'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

type ClearanceListEntry = {
  readonly caregiverId: string
  readonly name: string | null
  readonly stage: PipelineStage
  readonly readiness: ClearanceReadiness
}

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const getClearanceList: UseCase<Record<string, never>, readonly ClearanceListEntry[]> =
  defineUseCase('clearance.view', async ({ principal }) => {
    const rows = await findPipelineBoardRows(principal.agencyId, BOARD_STAGES)

    return rows
      .map((row) => {
        const nameParts = [row.legalFirstName, row.legalLastName].filter((part) => part !== null)
        return {
          caregiverId: row.caregiverId,
          name: nameParts.length === 0 ? null : nameParts.join(' '),
          stage: row.stage,
          readiness: clearanceReadiness(row.instances),
        }
      })
      .sort(
        (a, b) =>
          BOARD_STAGES.indexOf(b.stage) - BOARD_STAGES.indexOf(a.stage) ||
          (a.caregiverId < b.caregiverId ? -1 : a.caregiverId > b.caregiverId ? 1 : 0),
      )
  })
