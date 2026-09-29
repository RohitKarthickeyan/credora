import type { AgencyModel, AgencyUncheckedCreateInput } from './generated/models/Agency'
import type { UserModel, UserUncheckedCreateInput } from './generated/models/User'
import type { CorePrismaClient } from './prisma'

// Every import above is `import type` on purpose: erased under verbatimModuleSyntax, so this
// module has no runtime imports and stays loadable by `tsx prisma/seed.ts` (T-132), which has
// none of the app's path aliases. The client is a parameter for the same reason. Never import a
// value here.

export function createAgency(
  db: CorePrismaClient,
  overrides: Partial<AgencyUncheckedCreateInput> = {},
): Promise<AgencyModel> {
  return db.agency.create({ data: { name: 'Alvita Care', ...overrides } })
}

export function createUser(
  db: CorePrismaClient,
  agency: Pick<AgencyModel, 'id'>,
  overrides: Partial<Omit<UserUncheckedCreateInput, 'agencyId'>> = {},
): Promise<UserModel> {
  // User.email is unique, so the default is derived from the role; a second user with the same
  // role passes an explicit email.
  const role = overrides.role ?? 'COORDINATOR'

  return db.user.create({
    data: {
      agencyId: agency.id,
      role,
      email: `${role.toLowerCase()}@alvita.test`,
      fullName: 'Dana Whitfield',
      ...overrides,
    },
  })
}
