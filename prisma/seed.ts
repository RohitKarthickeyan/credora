import { prisma } from '@/db/prisma'
import { ALVITA_STAFF, DEMO_STAFF_PASSWORD, seedAlvitaReferenceData } from '@/db/seeds/alvita'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'
import { seedDemoCaregivers } from '@/server/dev/demo-seed'

// Runs under prisma/tsconfig.seed.json, which maps server-only to Next's empty module (ADR-085).

if (env.NODE_ENV === 'production') {
  throw new Error('The seed writes a known staff password and must never run in production.')
}

// tsx runs this file as CommonJS, which has no top-level await; an unhandled rejection still exits non-zero.
async function main(): Promise<void> {
  const ref = await seedAlvitaReferenceData(new Date())
  const outcomes = await seedDemoCaregivers({ ...ref, storage: getPort('storage') })

  console.log(`Staff (password ${DEMO_STAFF_PASSWORD}):`)
  for (const staff of ALVITA_STAFF) console.log(`  ${staff.role.padEnd(14)} ${staff.email}`)
  console.log('Demo caregivers:')
  for (const outcome of outcomes) {
    console.log(
      outcome.outcome === 'CREATED'
        ? `  CREATED ${outcome.key} ${outcome.stage} ${outcome.caregiverId}`
        : `  SKIPPED ${outcome.key} (already present)`,
    )
  }
  if (outcomes.some((outcome) => outcome.outcome === 'SKIPPED')) {
    console.log(
      'Skipped caregivers are not repaired. To rebuild from scratch: npx prisma migrate reset, ' +
        'delete ./storage, then npm run db:seed.',
    )
  }

  await prisma.$disconnect()
}

void main()
