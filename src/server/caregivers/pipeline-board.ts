import 'server-only'
import { findPipelineBoardRows } from '@/db/repositories/pipeline-board'
import {
  BOARD_STAGES,
  daysInStage,
  groupByStage,
  type PipelineBoardColumn,
} from '@/domain/pipeline/board'
import { MAX_UNCLEAR_REPLIES } from '@/domain/conversation/step'
import { currentBlocker } from '@/domain/requirements/blocker'
import type { UseCase } from '@/server/auth/policy'
import { can, defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry: a list view is not a view of each caregiver record (ADR-051).
export const getPipelineBoard: UseCase<Record<string, never>, readonly PipelineBoardColumn[]> =
  defineUseCase('pipeline.view', async ({ principal }) => {
    const rows = await findPipelineBoardRows(principal.agencyId, BOARD_STAGES)
    const now = new Date()
    const showsConversation = can(principal, 'conversation.manage')

    return groupByStage(
      rows.map((row) => {
        const nameParts = [row.legalFirstName, row.legalLastName].filter((part) => part !== null)
        return {
          caregiverId: row.caregiverId,
          name: nameParts.length === 0 ? null : nameParts.join(' '),
          stage: row.stage,
          daysInStage: daysInStage(row, now),
          blocker: currentBlocker(row.instances),
          conversation:
            showsConversation && row.conversation !== null
              ? {
                  paused: row.conversation.pausedAt !== null,
                  handedOff: row.conversation.unclearCount >= MAX_UNCLEAR_REPLIES,
                  needsReply: row.conversation.needsReplyAt !== null,
                }
              : null,
        }
      }),
    )
  })
