import 'server-only'
import { readSuccessMetricsFacts } from '@/db/repositories/success-metrics'
import {
  type SuccessMetricsReport,
  successMetricsWindow,
  summariseSuccessMetrics,
} from '@/domain/reports/success-metrics'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// No audit entry: aggregates only, no caregiver's record is shown.
export const getSuccessMetricsReport: UseCase<Record<string, never>, SuccessMetricsReport> = defineUseCase(
  'successMetrics.view',
  async ({ principal }) => {
    const window = successMetricsWindow(new Date())
    return summariseSuccessMetrics(window, await readSuccessMetricsFacts(principal.agencyId, window))
  },
)
