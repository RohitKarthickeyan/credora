import type { FormSection } from './definition'
import { EEOC_SELF_IDENTIFICATION_SECTION } from './sections/eeoc-self-identification'
import { MEDICAL_HISTORY_SECTION, PHYSICAL_CAPABILITY_SECTION } from './sections/medical-questionnaire'

export type RestrictedStore = 'MEDICAL' | 'EEOC'

export const RESTRICTED_INTAKE_SECTIONS: readonly FormSection[] = [
  MEDICAL_HISTORY_SECTION,
  PHYSICAL_CAPABILITY_SECTION,
  EEOC_SELF_IDENTIFICATION_SECTION,
]

const STORE_BY_SECTION_ID: ReadonlyMap<string, RestrictedStore> = new Map<string, RestrictedStore>([
  [MEDICAL_HISTORY_SECTION.id, 'MEDICAL'],
  [PHYSICAL_CAPABILITY_SECTION.id, 'MEDICAL'],
  [EEOC_SELF_IDENTIFICATION_SECTION.id, 'EEOC'],
])

export function restrictedStoreOf(section: FormSection): RestrictedStore | null {
  return STORE_BY_SECTION_ID.get(section.id) ?? null
}
