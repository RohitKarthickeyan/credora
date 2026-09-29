import 'server-only'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { createAttestation } from '@/db/repositories/attestations'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import {
  type InstanceStatusChange,
  changeRequirementInstanceStatus,
  findRequirementInstances,
  linkEvidence,
} from '@/db/repositories/requirement-instances'
import type { LoadedSection, SectionSaveResult } from '@/domain/forms/binding'
import type { FormSection } from '@/domain/forms/definition'
import {
  ALL_SECTIONS,
  type IntakeProgress,
  type SectionMissing,
  intakeInstanceMoves,
  intakeProgress,
  intakeSubmittedEvidenceKey,
  mustStayComplete,
  sectionAfter,
  sectionsSharingIntakeKeys,
} from '@/domain/forms/intake-flow'
import { restrictedStoreOf } from '@/domain/forms/restricted'
import type { SectionSummary } from '@/domain/forms/summary'
import { validateSection } from '@/domain/forms/validate'
import { activeRequirementKeys, visibleSections } from '@/domain/forms/visibility'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import {
  loadEeocIntakeSection,
  loadMedicalIntakeSection,
  saveEeocIntakeSection,
  saveMedicalIntakeSection,
  summariseEeocIntakeSections,
  summariseMedicalIntakeSections,
} from './restricted-sections'
import {
  type IntakeSectionInput,
  type SummariseUseCase,
  loadIntakeMissing,
  loadIntakeSection,
  loadIntakeSummaries,
  saveIntakeSection,
} from './section'

type SectionStore = {
  readonly load: UseCase<IntakeSectionInput, LoadedSection>
  readonly save: UseCase<IntakeSectionInput & { readonly answers: unknown }, SectionSaveResult>
  readonly summarise: SummariseUseCase
}

const RECORD_STORE: SectionStore = {
  load: loadIntakeSection,
  save: saveIntakeSection,
  summarise: loadIntakeSummaries,
}

const MEDICAL_STORE: SectionStore = {
  load: loadMedicalIntakeSection,
  save: saveMedicalIntakeSection,
  summarise: summariseMedicalIntakeSections,
}
const EEOC_STORE: SectionStore = {
  load: loadEeocIntakeSection,
  save: saveEeocIntakeSection,
  summarise: summariseEeocIntakeSections,
}

// The only place a store is chosen (ADR-081).
function storeFor(section: FormSection): SectionStore {
  switch (restrictedStoreOf(section)) {
    case 'MEDICAL':
      return MEDICAL_STORE
    case 'EEOC':
      return EEOC_STORE
    case null:
      return RECORD_STORE
  }
}

async function visibleFor(agencyId: string, caregiverId: string) {
  const instances = await findRequirementInstances(agencyId, caregiverId)
  return { instances, sections: visibleSections(ALL_SECTIONS, activeRequirementKeys(instances)) }
}

async function missingFor(
  caregiverId: string,
  sections: readonly FormSection[],
): Promise<Readonly<Record<string, SectionMissing>>> {
  const recordSections = sections.filter((section) => storeFor(section) === RECORD_STORE)
  const missing: Record<string, SectionMissing> =
    recordSections.length === 0 ? {} : { ...(await loadIntakeMissing({ caregiverId, sections: recordSections })) }
  for (const section of sections) {
    if (storeFor(section) === RECORD_STORE) continue
    const loaded = await storeFor(section).load({ caregiverId, section })
    missing[section.id] = validateSection(loaded.section, loaded.answers, new Date()).missing
  }
  return missing
}

async function summariesFor(
  caregiverId: string,
  sections: readonly FormSection[],
): Promise<readonly SectionSummary[]> {
  const groups = new Map<SectionStore, FormSection[]>()
  for (const section of sections) {
    const store = storeFor(section)
    groups.set(store, [...(groups.get(store) ?? []), section])
  }
  const summaries: Record<string, SectionSummary> = {}
  for (const [store, group] of groups) Object.assign(summaries, await store.summarise({ caregiverId, sections: group }))
  return sections.map((section) => {
    const summary = summaries[section.id]
    if (summary === undefined) throw new Error(`No summary was loaded for section ${section.id}.`)
    return summary
  })
}

const missingOf = (missing: Readonly<Record<string, SectionMissing>>, section: FormSection): SectionMissing => {
  const found = missing[section.id]
  if (found === undefined) throw new Error(`No missing list was loaded for section ${section.id}.`)
  return found
}

function requireChanged(change: InstanceStatusChange, instanceId: string): void {
  if (change.ok || (change.to === 'PENDING' && change.refusal === 'ALREADY_IN_STATUS')) return
  throw new Error(
    `Requirement instance ${instanceId} could not move ${change.from} → ${change.to} ` +
      `(${change.refusal}); a concurrent writer changed it.`,
  )
}

export const viewIntakeOverview: UseCase<{ readonly caregiverId: string }, IntakeProgress> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) => {
    const { sections } = await visibleFor(principal.agencyId, input.caregiverId)
    const missing = await missingFor(input.caregiverId, sections)
    return intakeProgress(sections.map((section) => ({ section, missing: missingOf(missing, section) })))
  },
)

export const viewOwnRecord: UseCase<{ readonly caregiverId: string }, readonly SectionSummary[]> = defineUseCase(
  'caregiver.viewOwn',
  async ({ principal, input }) => {
    const { sections } = await visibleFor(principal.agencyId, input.caregiverId)
    return summariesFor(input.caregiverId, sections)
  },
)

export type OpenedIntakeStep = {
  readonly loaded: LoadedSection
  readonly position: number
  readonly total: number
}

export const openIntakeStep: UseCase<
  { readonly caregiverId: string; readonly stepId: string },
  OpenedIntakeStep | null
> = defineUseCase('caregiver.viewOwn', async ({ principal, input }) => {
  const { sections } = await visibleFor(principal.agencyId, input.caregiverId)
  const index = sections.findIndex((section) => section.id === input.stepId)
  const section = sections[index]
  if (section === undefined) return null
  const loaded = await storeFor(section).load({ caregiverId: input.caregiverId, section })
  return { loaded, position: index + 1, total: sections.length }
})

export type IntakeStepSaveResult = SectionSaveResult & { readonly next: string | null }

/**
 * The save and the settlement are two transactions, because a restricted store cannot join the
 * core one. Settlement is recomputed from stored state on every save of a sibling, so a failed
 * settlement heals on the next save (ADR-080).
 */
export const saveIntakeStep: UseCase<
  { readonly caregiverId: string; readonly stepId: string; readonly answers: unknown },
  IntakeStepSaveResult | null
> = defineUseCase('caregiver.editOwn', async ({ principal, input }) => {
  const { agencyId } = principal
  const { caregiverId, stepId, answers } = input

  const { instances, sections } = await visibleFor(agencyId, caregiverId)
  const section = sections.find((candidate) => candidate.id === stepId)
  if (section === undefined) return null
  const store = storeFor(section)

  if (mustStayComplete(section, instances)) {
    const loaded = await store.load({ caregiverId, section })
    const { invalid, missing } = validateSection(loaded.section, answers, new Date())
    if (Object.keys(invalid).length > 0 || Object.keys(missing).length > 0) {
      return { invalid, missing, saved: false, next: null }
    }
  }

  const result = await store.save({ caregiverId, section, answers })
  if (!result.saved) return { ...result, next: null }

  const siblingSections = sectionsSharingIntakeKeys(sections, section)
  const siblingMissing = await missingFor(caregiverId, siblingSections)
  const moves = intakeInstanceMoves({
    saved: { section, missing: result.missing },
    siblings: siblingSections.map((sibling) => ({ section: sibling, missing: missingOf(siblingMissing, sibling) })),
    instances,
  })

  await runInAuditedTransaction(async (tx) => {
    // Refusals are ignored: a caregiver in a later stage may still edit.
    await applyPipelineTransition(tx, agencyId, { caregiverId, event: 'INTAKE_STARTED', actorUserId: null })

    for (const move of moves) {
      const from = instances.find((candidate) => candidate.id === move.instanceId)?.status
      if (move.to === 'PENDING' || from === 'NOT_STARTED') {
        requireChanged(await changeRequirementInstanceStatus(agencyId, move.instanceId, 'PENDING'), move.instanceId)
      }
      if (move.to === 'PENDING') continue

      const attestation = await createAttestation(agencyId, caregiverId)
      const evidenceKey = intakeSubmittedEvidenceKey(move.templateKey)
      const link = await linkEvidence(agencyId, move.instanceId, evidenceKey, {
        kind: 'ATTESTATION',
        attestationId: attestation.id,
      })
      if (!link.ok) {
        throw new Error(`Requirement instance ${move.instanceId} does not accept ATTESTATION ${evidenceKey}.`)
      }
      requireChanged(await changeRequirementInstanceStatus(agencyId, move.instanceId, 'SATISFIED'), move.instanceId)
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
        fieldName: 'attestations',
      })
    }
  })

  return { ...result, next: sectionAfter(sections, stepId)?.id ?? null }
})
