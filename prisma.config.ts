import { defineConfig } from 'prisma/config'
import { databaseUrl } from './prisma/database-url'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: databaseUrl() },
  migrations: { path: 'prisma/migrations', seed: 'tsx --tsconfig prisma/tsconfig.seed.json --env-file-if-exists=.env prisma/seed.ts' },
})
