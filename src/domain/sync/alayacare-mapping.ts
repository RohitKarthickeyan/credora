import { z } from 'zod'
import { RECORD_FIELDS, type RecordFieldName } from '@/domain/forms/canonical-record'

// Mirrors the Prisma enum CredentialType; keep the two in step.
export const CREDENTIAL_TYPES = ['PCA', 'HHA', 'CNA', 'CPR', 'TB_CLEARANCE', 'PHYSICAL'] as const
export type CredentialType = (typeof CREDENTIAL_TYPES)[number]

export const ALAYACARE_CUSTOM_FIELD_TYPES = ['text', 'boolean', 'date'] as const
type AlayaCareCustomFieldType = (typeof ALAYACARE_CUSTOM_FIELD_TYPES)[number]

// Standard tier only (DATA-MODEL § Field groups). An explicit allowlist, never derived from
// RECORD_FIELDS: a column added to the catalogue later must not become mappable by accident.
// The vaccination answers (COVID, Hep B, flu) are left out until OPEN-QUESTIONS 89/93 settle
// whether they are health data.
export const MAPPABLE_RECORD_FIELDS = [
  'mobilePhone',
  'alternatePhone',
  'email',
  'preferredLanguage',
  'certificationsHeld',
  'clinicalSkills',
  'shiftTypes',
  'serviceAreas',
  'languages',
  'worksWithPets',
  'worksWithSmokers',
  'hasVehicle',
] as const satisfies readonly RecordFieldName[]
export type MappableRecordField = (typeof MAPPABLE_RECORD_FIELDS)[number]

export const CREDENTIAL_PARTS = ['number', 'issuedOn', 'expiresOn'] as const
export type CredentialPart = (typeof CREDENTIAL_PARTS)[number]

export const mappingSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('recordField'), field: z.enum(MAPPABLE_RECORD_FIELDS) }),
  z.strictObject({
    kind: z.literal('credential'),
    credentialType: z.enum(CREDENTIAL_TYPES),
    part: z.enum(CREDENTIAL_PARTS),
  }),
])
export type MappingSource = z.infer<typeof mappingSourceSchema>

const alayaCareKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/)

export type SourceValueType = 'text' | 'textList' | 'boolean' | 'date'

export function sourceValueType(source: MappingSource): SourceValueType {
  if (source.kind === 'recordField') return RECORD_FIELDS[source.field].type
  return source.part === 'number' ? 'text' : 'date'
}

const ACCEPTED_SOURCE_TYPES: Record<AlayaCareCustomFieldType, readonly SourceValueType[]> = {
  text: ['text', 'textList'],
  boolean: ['boolean'],
  date: ['date'],
}

const customFieldMappingSchema = z
  .strictObject({
    alayaCareKey: alayaCareKeySchema,
    alayaCareType: z.enum(ALAYACARE_CUSTOM_FIELD_TYPES),
    source: mappingSourceSchema,
  })
  .refine(
    (field) => ACCEPTED_SOURCE_TYPES[field.alayaCareType].includes(sourceValueType(field.source)),
    { message: 'This source cannot fill an AlayaCare field of that type.', path: ['source'] },
  )
export type CustomFieldMapping = z.infer<typeof customFieldMappingSchema>

const credentialCodesSchema = z.partialRecord(z.enum(CREDENTIAL_TYPES), alayaCareKeySchema)

export const alayaCareMappingSchema = z
  .strictObject({
    credentialCodes: credentialCodesSchema,
    customFields: z.array(customFieldMappingSchema).max(100),
  })
  .refine(
    (mapping) =>
      new Set(mapping.customFields.map((field) => field.alayaCareKey)).size ===
      mapping.customFields.length,
    { message: 'Each AlayaCare field may be mapped once.', path: ['customFields'] },
  )
export type AlayaCareMapping = z.infer<typeof alayaCareMappingSchema>

export const EMPTY_ALAYACARE_MAPPING: AlayaCareMapping = { credentialCodes: {}, customFields: [] }

export type StoredAlayaCareMapping = {
  readonly version: number
  readonly mapping: AlayaCareMapping
}

export const alayaCareMappingChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setCredentialCodes'), credentialCodes: credentialCodesSchema }),
  z.strictObject({ kind: z.literal('addCustomField'), field: customFieldMappingSchema }),
  z.strictObject({ kind: z.literal('removeCustomField'), alayaCareKey: alayaCareKeySchema }),
])
export type AlayaCareMappingChange = z.infer<typeof alayaCareMappingChangeSchema>

export type AlayaCareMappingChangeResult =
  | { readonly ok: true; readonly mapping: AlayaCareMapping }
  | { readonly ok: false; readonly reason: 'DUPLICATE_KEY' | 'UNKNOWN_KEY' }

function nextMapping(
  mapping: AlayaCareMapping,
  change: AlayaCareMappingChange,
): AlayaCareMappingChangeResult {
  const isKey = (key: string) => (field: CustomFieldMapping) => field.alayaCareKey === key

  switch (change.kind) {
    case 'setCredentialCodes':
      return { ok: true, mapping: { ...mapping, credentialCodes: change.credentialCodes } }
    case 'addCustomField':
      if (mapping.customFields.some(isKey(change.field.alayaCareKey))) {
        return { ok: false, reason: 'DUPLICATE_KEY' }
      }
      return { ok: true, mapping: { ...mapping, customFields: [...mapping.customFields, change.field] } }
    case 'removeCustomField':
      if (!mapping.customFields.some(isKey(change.alayaCareKey))) {
        return { ok: false, reason: 'UNKNOWN_KEY' }
      }
      return {
        ok: true,
        mapping: {
          ...mapping,
          customFields: mapping.customFields.filter((field) => !isKey(change.alayaCareKey)(field)),
        },
      }
  }
}

export function applyAlayaCareMappingChange(
  mapping: AlayaCareMapping,
  change: AlayaCareMappingChange,
): AlayaCareMappingChangeResult {
  const result = nextMapping(mapping, alayaCareMappingChangeSchema.parse(change))
  return result.ok ? { ok: true, mapping: alayaCareMappingSchema.parse(result.mapping) } : result
}

export type SyncSourceCredential = {
  readonly credentialId: string
  readonly type: CredentialType
  readonly number: string | null
  readonly issuer: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  readonly documentKey: string | null
}

export type AlayaCareSyncSource = {
  // Keyed by MappableRecordField, so T-111's reader has no slot for a restricted value.
  readonly recordFields: Readonly<
    Partial<Record<MappableRecordField, string | boolean | readonly string[] | null>>
  >
  readonly credentials: readonly SyncSourceCredential[]
}

export type MappedCredential = {
  readonly credentialId: string
  readonly code: string
  readonly number: string | null
  readonly issuer: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  readonly documentKey: string | null
}

export type UnresolvedCustomField = {
  readonly alayaCareKey: string
  readonly reason: 'NO_VALUE' | 'AMBIGUOUS_CREDENTIAL'
}

export type AlayaCareProjection = {
  readonly credentials: readonly MappedCredential[]
  readonly unmappedCredentialTypes: readonly CredentialType[]
  readonly customFields: Readonly<Record<string, string>>
  readonly unresolvedCustomFields: readonly UnresolvedCustomField[]
}

type Resolved = { readonly value: string } | { readonly reason: UnresolvedCustomField['reason'] }

// The mock rejects an empty text value, and writing a blank would erase AlayaCare's value, so an
// empty source is NO_VALUE rather than ''.
function resolveRecordField(value: string | boolean | readonly string[] | null | undefined): Resolved {
  if (value === null || value === undefined) return { reason: 'NO_VALUE' }
  if (typeof value === 'boolean') return { value: value ? 'true' : 'false' }
  if (typeof value === 'string') return value.trim() === '' ? { reason: 'NO_VALUE' } : { value }
  return value.length === 0 ? { reason: 'NO_VALUE' } : { value: value.join(', ') }
}

// Several credentials of one type are never chosen between: picking one would be an invented rule.
function resolveCredential(
  credentials: readonly SyncSourceCredential[],
  type: CredentialType,
  part: CredentialPart,
): Resolved {
  const matching = credentials.filter((credential) => credential.type === type)
  if (matching.length > 1) return { reason: 'AMBIGUOUS_CREDENTIAL' }
  const value = matching[0]?.[part] ?? null
  return value === null ? { reason: 'NO_VALUE' } : { value }
}

export function projectAlayaCareFields(
  mapping: AlayaCareMapping,
  source: AlayaCareSyncSource,
): AlayaCareProjection {
  const credentials: MappedCredential[] = []
  const unmapped = new Set<CredentialType>()
  for (const credential of source.credentials) {
    const code = mapping.credentialCodes[credential.type]
    if (code === undefined) {
      unmapped.add(credential.type)
      continue
    }
    credentials.push({
      credentialId: credential.credentialId,
      code,
      number: credential.number,
      issuer: credential.issuer,
      issuedOn: credential.issuedOn,
      expiresOn: credential.expiresOn,
      documentKey: credential.documentKey,
    })
  }

  const customFields: Record<string, string> = {}
  const unresolvedCustomFields: UnresolvedCustomField[] = []
  for (const field of mapping.customFields) {
    const resolved =
      field.source.kind === 'recordField'
        ? resolveRecordField(source.recordFields[field.source.field])
        : resolveCredential(source.credentials, field.source.credentialType, field.source.part)
    if ('value' in resolved) customFields[field.alayaCareKey] = resolved.value
    else unresolvedCustomFields.push({ alayaCareKey: field.alayaCareKey, reason: resolved.reason })
  }

  return {
    credentials,
    unmappedCredentialTypes: CREDENTIAL_TYPES.filter((type) => unmapped.has(type)),
    customFields,
    unresolvedCustomFields,
  }
}
