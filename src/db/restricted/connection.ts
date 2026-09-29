import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '@/lib/env'
import { PrismaClient } from '../generated/client'

const globalForPrisma = globalThis as unknown as { restrictedClient?: PrismaClient }

export const restrictedClient: PrismaClient =
  globalForPrisma.restrictedClient ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) })

if (env.NODE_ENV !== 'production') globalForPrisma.restrictedClient = restrictedClient
