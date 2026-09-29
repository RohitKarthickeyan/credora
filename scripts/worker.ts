import { hostname } from 'node:os'
import { prisma } from '@/db/prisma'
import { runWorker } from '@/integrations/queue/worker'
import { assertEveryPortResolves } from '@/integrations/registry'
import { runAsSystem } from '@/server/auth/context'
import { jobRegistry } from '@/server/jobs/handlers'
import { ensureRetentionSchedules } from '@/server/retention/schedule'

// Runs under prisma/tsconfig.seed.json, which maps server-only to Next's empty module (ADR-085, ADR-089).

// tsx runs this file as CommonJS, which has no top-level await; an unhandled rejection still exits non-zero.
async function main(): Promise<void> {
  const controller = new AbortController()
  // `once`: a second Ctrl+C gets Node's default and kills the process; the lease recovers its job.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.info(`Worker received ${signal}; finishing the current cycle.`)
      controller.abort()
    })
  }

  assertEveryPortResolves()

  // Distinct per process: lease ownership is only as strong as worker ids being distinct (ADR-023).
  const workerId = `${hostname()}:${process.pid}`
  console.info(`Worker ${workerId} started.`)

  await runAsSystem(async () => {
    await ensureRetentionSchedules(new Date())
    await runWorker({
      registry: jobRegistry,
      clock: () => new Date(),
      workerId,
      signal: controller.signal,
    })
  })

  await prisma.$disconnect()
  console.info(`Worker ${workerId} stopped.`)
}

void main()
