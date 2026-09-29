import type { Prisma, PrismaClient } from './generated/client'
import { restrictedClient } from './restricted/connection'

// Every delegate in the medical and eeoc schemas. CorePrismaClient and AuditedTx both omit
// exactly this list, so a restricted model added here is closed off in both places at once.
export type RestrictedDelegate =
  | 'medicalFile'
  | 'medicalAnswer'
  | 'medicalScreeningResult'
  | 'clinicalDocumentText'
  | 'clinicalJudgeReasons'
  | 'eeocRecord'

export type CorePrismaClient = Omit<PrismaClient, RestrictedDelegate>

// Re-exported because eslint.config.mjs forbids the rest of src/db/ from importing
// ./generated/client, and src/db/audit.ts needs this type.
export type PrismaTransactionClient = Prisma.TransactionClient

export const prisma: CorePrismaClient = restrictedClient
