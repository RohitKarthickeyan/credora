import type { PipelineStage } from '@/domain/pipeline/stage'
import { prisma } from '../prisma'

// A declared read without agencyId (DATA-MODEL.md § Invariants, ADR-058): a caregiver signs in
// with no tenant selector, so the email is what resolves the agency. Ids only, and at most two:
// the caller sends a code only when exactly one live caregiver holds the address.
export async function findCaregiversByEmail(
  email: string,
): Promise<{ readonly agencyId: string; readonly caregiverId: string }[]> {
  return prisma.contactRecord.findMany({
    where: { email, caregiver: { stage: { not: 'WITHDRAWN' } } },
    select: { agencyId: true, caregiverId: true },
    take: 2,
  })
}

export function findCaregiverForSession(
  agencyId: string,
  caregiverId: string,
): Promise<{ readonly id: string; readonly agencyId: string; readonly stage: PipelineStage } | null> {
  return prisma.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: { id: true, agencyId: true, stage: true },
  })
}
