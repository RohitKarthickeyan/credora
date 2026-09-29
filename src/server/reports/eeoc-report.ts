import 'server-only'
import { readEeocAggregateReport } from '@/db/restricted/eeoc'
import type { EeocAggregateReport } from '@/domain/eeoc/aggregate-report'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's: can() is not an agency check. The
// accessor writes the audit entry.
export const getEeocAggregateReport: UseCase<Record<string, never>, EeocAggregateReport> = defineUseCase(
  'eeocReport.view',
  ({ principal }) => readEeocAggregateReport(principal.agencyId),
)
