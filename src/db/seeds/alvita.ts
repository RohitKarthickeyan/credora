import { hashPassword } from '@/lib/password'
import { createAgency, createUser } from '../factories'
import { prisma } from '../prisma'
import { seedAlvitaAlayaCareMapping } from './alvita-alayacare-mapping'
import { seedDemoPlatformRequirementTemplates } from './demo-requirement-templates'
import { seedNyAcceptedIssuers } from './ny-accepted-issuers'
import {
  seedNyAgencyRequirementTemplates,
  seedNyPlatformRequirementTemplates,
} from './ny-requirement-templates'

// Value-imports ../prisma and @/lib/password, both server-only: legal only because
// prisma/seed.ts runs under prisma/tsconfig.seed.json (ADR-085).

const ALVITA_AGENCY_NAME = 'Alvita Care'

// Placeholder until Alvita names its vendor package.
export const ALVITA_BACKGROUND_CHECK_PACKAGE_CODE = 'ALVITA-PLACEHOLDER'

export const DEMO_STAFF_PASSWORD = 'alvita-demo-2026'

export const ALVITA_STAFF: readonly {
  readonly role: 'COORDINATOR' | 'SUPERVISOR' | 'AGENCY_ADMIN' | 'IMPLEMENTATION'
  readonly email: string
  readonly fullName: string
}[] = [
  { role: 'COORDINATOR', email: 'coordinator@alvita.test', fullName: 'Dana Whitfield' },
  { role: 'SUPERVISOR', email: 'supervisor@alvita.test', fullName: 'Rosa Delgado' },
  { role: 'AGENCY_ADMIN', email: 'admin@alvita.test', fullName: 'Kevin Osei' },
  { role: 'IMPLEMENTATION', email: 'implementation@alvita.test', fullName: 'Priya Raman' },
]

export async function seedAlvitaReferenceData(now: Date): Promise<{
  readonly agencyId: string
  readonly coordinatorUserId: string
}> {
  const agency =
    (await prisma.agency.findFirst({
      where: { name: ALVITA_AGENCY_NAME },
      orderBy: { createdAt: 'asc' },
    })) ?? (await createAgency(prisma, { name: ALVITA_AGENCY_NAME }))
  await prisma.agency.updateMany({
    where: { id: agency.id, backgroundCheckPackageCode: null },
    data: { backgroundCheckPackageCode: ALVITA_BACKGROUND_CHECK_PACKAGE_CODE },
  })

  let coordinatorUserId: string | undefined
  for (const staff of ALVITA_STAFF) {
    const existing = await prisma.user.findUnique({ where: { email: staff.email } })
    if (existing !== null && existing.agencyId !== agency.id) {
      throw new Error(
        `${staff.email} belongs to agency ${existing.agencyId}, not ${ALVITA_AGENCY_NAME} ` +
          `(${agency.id}); this database was not built by this seed.`,
      )
    }
    const user =
      existing ??
      (await createUser(prisma, agency, {
        ...staff,
        passwordHash: await hashPassword(DEMO_STAFF_PASSWORD),
      }))
    if (staff.role === 'COORDINATOR') coordinatorUserId = user.id
  }
  if (coordinatorUserId === undefined) throw new Error('ALVITA_STAFF names no coordinator.')

  await seedNyPlatformRequirementTemplates(prisma, now)
  await seedDemoPlatformRequirementTemplates(prisma, now)
  await seedNyAgencyRequirementTemplates(prisma, agency.id, now)
  await seedNyAcceptedIssuers(prisma, agency.id)
  await seedAlvitaAlayaCareMapping(prisma, agency.id)

  return { agencyId: agency.id, coordinatorUserId }
}
