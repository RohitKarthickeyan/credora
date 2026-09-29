import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { InstanceStatus } from '@/domain/requirements/instance-status'
import type { FormSection } from './definition'
import { CHRC_DESCRIPTORS_SECTION } from './sections/chrc-descriptors'
import { CONTACT_SECTION } from './sections/contact'
import { EDUCATION_SECTION } from './sections/education'
import { EMERGENCY_CONTACTS_SECTION } from './sections/emergency-contacts'
import { EMPLOYMENT_HISTORY_SECTION } from './sections/employment-history'
import { GOVERNMENT_ID_SECTION } from './sections/government-id'
import { HOME_CARE_PROFILE_SECTIONS } from './sections/home-care-profile'
import { IDENTITY_SECTION } from './sections/identity'
import {
  PAYROLL_DIRECT_DEPOSIT_SECTION,
  PAYROLL_IT2104_SECTION,
  PAYROLL_W4_SECTION,
} from './sections/payroll'
import { RESTRICTED_INTAKE_SECTIONS } from './restricted'
import { REFERENCES_SECTION } from './sections/references'
import type { SectionIssues } from './validate'
import { FLU_VACCINATION_SECTION, HEPATITIS_B_SECTION } from './vaccination'

// The array order is the flow order (ADR-081).
export const ALL_SECTIONS: readonly FormSection[] = [
  IDENTITY_SECTION,
  CONTACT_SECTION,
  GOVERNMENT_ID_SECTION,
  CHRC_DESCRIPTORS_SECTION,
  EMPLOYMENT_HISTORY_SECTION,
  EDUCATION_SECTION,
  REFERENCES_SECTION,
  EMERGENCY_CONTACTS_SECTION,
  ...HOME_CARE_PROFILE_SECTIONS,
  HEPATITIS_B_SECTION,
  FLU_VACCINATION_SECTION,
  PAYROLL_W4_SECTION,
  PAYROLL_IT2104_SECTION,
  PAYROLL_DIRECT_DEPOSIT_SECTION,
  ...RESTRICTED_INTAKE_SECTIONS,
]

export type SectionMissing = SectionIssues['missing']
type InstanceView = { readonly id: string; readonly templateKey: string; readonly status: InstanceStatus }
type SectionWithMissing = { readonly section: FormSection; readonly missing: SectionMissing }

const INTAKE_KEYS: ReadonlySet<string> = new Set(Object.values(INTAKE_REQUIREMENT_KEYS))

const intakeKeysOf = (section: FormSection) => section.requiredBy.filter((key) => INTAKE_KEYS.has(key))

const isEmpty = (missing: SectionMissing) => Object.keys(missing).length === 0

export function sectionAfter(sections: readonly FormSection[], sectionId: string): FormSection | undefined {
  const index = sections.findIndex((section) => section.id === sectionId)
  return index === -1 ? undefined : sections[index + 1]
}

export function sectionsSharingIntakeKeys(
  sections: readonly FormSection[],
  section: FormSection,
): readonly FormSection[] {
  const keys = intakeKeysOf(section)
  return sections.filter(
    (other) => other.id !== section.id && other.requiredBy.some((key) => keys.includes(key)),
  )
}

export function intakeSubmittedEvidenceKey(requirementKey: string): string {
  return `${requirementKey}_SUBMITTED`
}

// There is no SATISFIED → PENDING edge, so a satisfied section must never save incomplete.
export function mustStayComplete(section: FormSection, instances: readonly InstanceView[]): boolean {
  const keys = intakeKeysOf(section)
  return instances.some((instance) => instance.status === 'SATISFIED' && keys.includes(instance.templateKey))
}

type IntakeInstanceMove = {
  readonly instanceId: string
  readonly templateKey: string
  readonly to: 'PENDING' | 'SATISFIED'
}

export function intakeInstanceMoves(input: {
  readonly saved: SectionWithMissing
  readonly siblings: readonly SectionWithMissing[]
  readonly instances: readonly InstanceView[]
}): readonly IntakeInstanceMove[] {
  return intakeKeysOf(input.saved.section).flatMap((key): IntakeInstanceMove[] => {
    const instance = input.instances.find((candidate) => candidate.templateKey === key)
    if (instance === undefined) return []

    const complete =
      isEmpty(input.saved.missing) &&
      input.siblings
        .filter((sibling) => sibling.section.requiredBy.includes(key))
        .every((sibling) => isEmpty(sibling.missing))
    const move = (to: IntakeInstanceMove['to']) => [{ instanceId: instance.id, templateKey: key, to }]

    if (instance.status === 'NOT_STARTED') return move(complete ? 'SATISFIED' : 'PENDING')
    if (instance.status === 'PENDING' && complete) return move('SATISFIED')
    return []
  })
}

function unresolved(section: FormSection, path: string): Error {
  return new Error(`Missing path "${path}" does not resolve in section ${section.id}.`)
}

// Labels come from the definition only, so no answer can reach the missing list.
function missingLabel(section: FormSection, path: string, message: string): { index: number; label: string } {
  const [id, second, third, ...rest] = path.split('.')
  const index = section.items.findIndex((candidate) => candidate.id === id)
  const item = section.items[index]
  if (item === undefined) throw unresolved(section, path)

  if (item.kind !== 'group') {
    if (second === undefined || (item.kind === 'address' && third === undefined)) {
      return { index, label: item.label }
    }
    throw unresolved(section, path)
  }

  if (second === undefined) return { index, label: `${item.label}: ${message}` }
  const entry = Number(second)
  const field = item.fields.find((candidate) => candidate.id === third)
  if (
    !Number.isInteger(entry) ||
    field === undefined ||
    rest.length > 1 ||
    (rest.length === 1 && field.kind !== 'address')
  ) {
    throw unresolved(section, path)
  }
  return { index, label: `${field.label} (${item.itemLabel} ${entry + 1})` }
}

function missingLabels(section: FormSection, missing: SectionMissing): readonly string[] {
  const labels = Object.entries(missing)
    .map(([path, message]) => missingLabel(section, path, message))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.label)
  return [...new Set(labels)]
}

export type IntakeProgress = {
  readonly completed: number
  readonly total: number
  readonly sections: readonly {
    readonly id: string
    readonly title: string
    readonly missing: readonly string[]
  }[]
}

export function intakeProgress(entries: readonly SectionWithMissing[]): IntakeProgress {
  return {
    completed: entries.filter((entry) => isEmpty(entry.missing)).length,
    total: entries.length,
    sections: entries.map(({ section, missing }) => ({
      id: section.id,
      title: section.title,
      missing: missingLabels(section, missing),
    })),
  }
}
