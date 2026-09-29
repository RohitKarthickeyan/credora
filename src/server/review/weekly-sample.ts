import 'server-only'
import { findAutoAcceptDecision } from '@/db/repositories/auto-accept-decisions'
import { findJudgeDecision, readJudgeReasons } from '@/db/repositories/judge-decisions'
import { findAutoAcceptedDocumentRows } from '@/db/repositories/weekly-sample'
import type { JudgeReasoning } from '@/domain/documents/exception-queue'
import {
  type SampledRecord,
  type WeeklySample,
  previousSampleWeek,
  selectWeeklySample,
} from '@/domain/documents/weekly-sample'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's: can() is not an agency check (T-014).
// No audit entry (ADR-105, ADR-109).
export const getWeeklySample: UseCase<Record<string, never>, WeeklySample> = defineUseCase(
  'weeklySample.view',
  async ({ principal }) => {
    const { agencyId } = principal
    const week = previousSampleWeek(new Date())
    const rows = await findAutoAcceptedDocumentRows(agencyId, week)

    const records: SampledRecord[] = []
    // Sequential: each finder opens its own transaction, and concurrent ones would exhaust the pool.
    for (const { clinical, ...row } of selectWeeklySample(week.key, rows)) {
      const autoAccept = await findAutoAcceptDecision(agencyId, row.uploadedDocumentId)
      const judge = await findJudgeDecision(agencyId, row.uploadedDocumentId)
      if (autoAccept === null || judge === null) continue

      // The clinical test comes before any reasons read: for a clinic result that read is an audited
      // medical read, and a coordinator is not permitted medical detail (SECURITY.md).
      let judgeReasoning: JudgeReasoning
      if (judge.basis.kind === 'ALLOWLISTED') judgeReasoning = { kind: 'SHOWN', reasons: [] }
      else if (clinical) judgeReasoning = { kind: 'CLINICAL' }
      else judgeReasoning = { kind: 'SHOWN', reasons: (await readJudgeReasons(agencyId, row.uploadedDocumentId)) ?? [] }

      records.push({ ...row, identity: autoAccept.identity, judge, judgeReasoning })
    }
    return { week, autoAccepted: rows.length, records }
  },
)
