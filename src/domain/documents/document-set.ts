import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { AcceptedEvidence, RequirementType } from '@/domain/requirements/template'

export type DocumentSetCandidate = {
  readonly instanceId: string
  readonly requirementKey: string
  readonly requirementType: RequirementType
  readonly status: InstanceStatus
  readonly acceptedEvidence: readonly AcceptedEvidence[]
}

export type DocumentSetRequirement = Pick<
  DocumentSetCandidate,
  'instanceId' | 'requirementKey' | 'requirementType'
>

export type DocumentSetEntry = {
  readonly documentKey: string
  readonly label: string
  readonly satisfies: readonly DocumentSetRequirement[]
}

export type DocumentSet = readonly DocumentSetEntry[]

const WAITING_ON_CAREGIVER: Readonly<Record<InstanceStatus, boolean>> = {
  NOT_STARTED: true,
  PENDING: true,
  IN_REVIEW: false,
  SATISFIED: false,
  EXCEPTION: false,
  WAIVED: false,
  EXPIRED: true,
}

type Draft = {
  label: string
  labelFrom: string
  readonly satisfies: DocumentSetRequirement[]
}

function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function selectDocumentSet(candidates: readonly DocumentSetCandidate[]): DocumentSet {
  const drafts = new Map<string, Draft>()

  for (const candidate of candidates) {
    if (!WAITING_ON_CAREGIVER[candidate.status]) continue
    const requirement: DocumentSetRequirement = {
      instanceId: candidate.instanceId,
      requirementKey: candidate.requirementKey,
      requirementType: candidate.requirementType,
    }
    for (const option of candidate.acceptedEvidence) {
      if (option.kind !== 'SIGNED_DOCUMENT') continue
      const draft = drafts.get(option.evidenceKey)
      if (draft === undefined) {
        drafts.set(option.evidenceKey, {
          label: option.label,
          labelFrom: candidate.requirementKey,
          satisfies: [requirement],
        })
        continue
      }
      draft.satisfies.push(requirement)
      if (byKey(candidate.requirementKey, draft.labelFrom) < 0) {
        draft.label = option.label
        draft.labelFrom = candidate.requirementKey
      }
    }
  }

  return [...drafts]
    .sort(([a], [b]) => byKey(a, b))
    .map(([documentKey, draft]) => ({
      documentKey,
      label: draft.label,
      satisfies: draft.satisfies.toSorted((a, b) => byKey(a.requirementKey, b.requirementKey)),
    }))
}
