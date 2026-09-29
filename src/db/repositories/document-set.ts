import {
  type DocumentSet,
  type DocumentSetCandidate,
  selectDocumentSet,
} from '@/domain/documents/document-set'
import type { AcceptedEvidenceModel } from '../generated/models/AcceptedEvidence'
import type { RequirementInstanceModel } from '../generated/models/RequirementInstance'
import type { RequirementTemplateModel } from '../generated/models/RequirementTemplate'
import { prisma } from '../prisma'

type InstanceRow = RequirementInstanceModel & {
  template: Pick<RequirementTemplateModel, 'type'> & {
    acceptedEvidence: AcceptedEvidenceModel[]
  }
}

function toCandidate(row: InstanceRow): DocumentSetCandidate {
  return {
    instanceId: row.id,
    requirementKey: row.templateKey,
    requirementType: row.template.type,
    status: row.status,
    acceptedEvidence: row.template.acceptedEvidence.map((option) => ({
      kind: option.kind,
      evidenceKey: option.evidenceKey,
      label: option.label,
    })),
  }
}

export async function findDocumentSet(agencyId: string, caregiverId: string): Promise<DocumentSet> {
  const rows = await prisma.requirementInstance.findMany({
    where: { agencyId, caregiverId },
    include: {
      template: {
        select: {
          type: true,
          acceptedEvidence: { orderBy: { evidenceKey: 'asc' } },
        },
      },
    },
  })

  return selectDocumentSet(rows.map(toCandidate))
}
