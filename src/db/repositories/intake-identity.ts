import type { IntakeIdentity } from '@/domain/identity/match'
import { fromDateColumn } from '../mapping/date-only'
import { satelliteKey } from '../mapping/scope'
import { prisma } from '../prisma'

// No audit entry: the caller's decision on this caregiver writes it (T-074).
export async function findIntakeIdentity(agencyId: string, caregiverId: string): Promise<IntakeIdentity> {
  const row = await prisma.identityRecord.findUnique({
    where: satelliteKey(agencyId, caregiverId),
    select: {
      legalFirstName: true,
      legalMiddleName: true,
      legalLastName: true,
      otherNames: true,
      dateOfBirth: true,
    },
  })

  if (row === null) {
    return { legalName: null, otherNames: [], dateOfBirth: null }
  }

  return {
    legalName:
      row.legalFirstName === null || row.legalLastName === null
        ? null
        : {
            first: row.legalFirstName,
            ...(row.legalMiddleName === null ? {} : { middle: row.legalMiddleName }),
            last: row.legalLastName,
          },
    otherNames: row.otherNames,
    dateOfBirth: fromDateColumn(row.dateOfBirth),
  }
}
