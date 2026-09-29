import {
  type CredentialPart,
  type CredentialType,
  type MappableRecordField,
  type MappingSource,
  CREDENTIAL_PARTS,
  CREDENTIAL_TYPES,
  MAPPABLE_RECORD_FIELDS,
  mappingSourceSchema,
} from '@/domain/sync/alayacare-mapping'

const RECORD_FIELD_LABELS: Record<MappableRecordField, string> = {
  mobilePhone: 'Mobile phone',
  alternatePhone: 'Alternate phone',
  email: 'Email',
  preferredLanguage: 'Preferred language',
  certificationsHeld: 'Certifications held',
  clinicalSkills: 'Clinical skills',
  shiftTypes: 'Shift types',
  serviceAreas: 'Service areas',
  languages: 'Languages',
  worksWithPets: 'Works with pets',
  worksWithSmokers: 'Works with smokers',
  hasVehicle: 'Has a vehicle',
}

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  PCA: 'PCA',
  HHA: 'HHA',
  CNA: 'CNA',
  CPR: 'CPR',
  TB_CLEARANCE: 'TB clearance',
  PHYSICAL: 'Physical',
}

const CREDENTIAL_PART_LABELS: Record<CredentialPart, string> = {
  number: 'number',
  issuedOn: 'issue date',
  expiresOn: 'expiry date',
}

function optionValue(source: MappingSource): string {
  return source.kind === 'recordField'
    ? `recordField:${source.field}`
    : `credential:${source.credentialType}:${source.part}`
}

export function sourceLabel(source: MappingSource): string {
  return source.kind === 'recordField'
    ? RECORD_FIELD_LABELS[source.field]
    : `${CREDENTIAL_TYPE_LABELS[source.credentialType]} credential · ${CREDENTIAL_PART_LABELS[source.part]}`
}

const SOURCES: readonly MappingSource[] = [
  ...MAPPABLE_RECORD_FIELDS.map((field) => ({ kind: 'recordField' as const, field })),
  ...CREDENTIAL_TYPES.flatMap((credentialType) =>
    CREDENTIAL_PARTS.map((part) => ({ kind: 'credential' as const, credentialType, part })),
  ),
]

export const SOURCE_OPTIONS: readonly { value: string; label: string }[] = SOURCES.map(
  (source) => ({ value: optionValue(source), label: sourceLabel(source) }),
)

export function parseSourceOption(value: string): MappingSource | null {
  const [kind, first, second] = value.split(':')
  const candidate =
    kind === 'credential' ? { kind, credentialType: first, part: second } : { kind, field: first }
  const parsed = mappingSourceSchema.safeParse(candidate)
  return parsed.success && optionValue(parsed.data) === value ? parsed.data : null
}
