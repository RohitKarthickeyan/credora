import {
  type AlayaCareMapping,
  alayaCareMappingSchema,
} from '@/domain/sync/alayacare-mapping'
import type { CorePrismaClient } from '../prisma'

// Value imports only from @/domain/ and the client as a parameter: `tsx prisma/seed.ts` (T-132)
// loads this module and cannot resolve `server-only` (ADR-054). Writes no audit entry, as the
// other seeds write none: a seed runs outside any request.

// Targets only what mock-servers/alayacare/seed.ts defines. A credential code is an AlayaCare skill
// id. PCA and CNA have no mock skill, and cleared_to_work and last_training_date have no mappable
// source, so they stay unmapped.
const ALVITA_ALAYACARE_MAPPING: AlayaCareMapping = {
  credentialCodes: {
    HHA: '1',
    TB_CLEARANCE: '2',
    CPR: '3',
    PHYSICAL: '4',
  },
  customFields: [
    {
      alayaCareKey: 'hha_registry_number',
      alayaCareType: 'text',
      source: { kind: 'credential', credentialType: 'HHA', part: 'number' },
    },
    {
      alayaCareKey: 'languages_spoken',
      alayaCareType: 'text',
      source: { kind: 'recordField', field: 'languages' },
    },
  ],
}

export async function seedAlvitaAlayaCareMapping(
  db: CorePrismaClient,
  agencyId: string,
): Promise<number> {
  const { count } = await db.alayaCareMapping.createMany({
    data: [{ agencyId, version: 1, config: alayaCareMappingSchema.parse(ALVITA_ALAYACARE_MAPPING) }],
    skipDuplicates: true,
  })
  return count
}
