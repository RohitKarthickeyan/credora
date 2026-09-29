import { z } from 'zod'
import { type UsState, addressSchema } from '@/domain/validation/address'
import { formatCents } from '@/domain/validation/money'
import { type RawAnswers, blankAnswers, emptyAnswers } from './answers'
import {
  COLLECTIONS,
  type CollectionName,
  RECORD_FIELDS,
  type RecordFieldName,
  type RecordName,
  type ValueType,
} from './canonical-record'
import type { FormField, FormGroup, FormSection } from './definition'
import { type SectionIssues, type SectionValidation, validateSection } from './validate'
import { visibleItems } from './visibility'

// Cannot collide with a field id: FIELD_ID_PATTERN admits no leading underscore.
export const ROW_ID_KEY = '_rowId'

type AddressParts = Readonly<Record<'line1' | 'line2' | 'city' | 'state' | 'zip', string | null>>
export type StoredValue = string | number | boolean | readonly string[] | AddressParts | null
export type StoredEntry = {
  readonly rowId: string
  readonly fields: Readonly<Record<string, StoredValue>>
}
export type StoredRecord = {
  readonly fields: Readonly<Partial<Record<RecordFieldName, StoredValue>>>
  readonly collections: Readonly<Partial<Record<CollectionName, readonly StoredEntry[]>>>
}
export type RecordScope = {
  readonly records: readonly RecordName[]
  readonly collections: readonly CollectionName[]
}
export type LoadedSection = { readonly section: FormSection; readonly answers: RawAnswers }

type AddressDraft = {
  line1: string | null
  line2: string | null
  city: string | null
  state: UsState | null
  zip: string | null
}
export type PatchValue = string | number | boolean | readonly string[] | AddressDraft | null
export type EntryPatch = {
  readonly rowId: string | null
  readonly fields: Readonly<Record<string, PatchValue>>
}
export type RecordPatch = {
  readonly fields: Readonly<Partial<Record<RecordFieldName, PatchValue>>>
  readonly collections: Readonly<
    Partial<
      Record<
        CollectionName,
        { readonly upserts: readonly EntryPatch[]; readonly deletes: readonly string[] }
      >
    >
  >
}
export type SavePlan =
  | { readonly status: 'rejected'; readonly issues: SectionIssues }
  | { readonly status: 'accepted'; readonly issues: SectionIssues; readonly patch: RecordPatch }
export type SectionSaveResult = SectionIssues & { readonly saved: boolean }

type FieldSpec = {
  readonly type: ValueType
  readonly notNull?: true
  readonly values?: readonly string[]
}
type RawValue = RawAnswers[string]
type SectionValues = SectionValidation['values']
type CanonicalValue = SectionValues[string]

// Stored encrypted and never read back: the stored value is its last four, `true` where no
// last-four column exists, or null when nothing is on file (SECURITY § Field masking).
const SEALED_TYPES: ReadonlySet<ValueType> = new Set([
  'ssn',
  'accountNumber',
  'routingNumber',
  'documentNumber',
])

const answersSchema = z.record(z.string(), z.unknown())
const entriesSchema = z.array(z.unknown())
const rawAddressSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
})

function asAnswers(input: unknown): Readonly<Record<string, unknown>> {
  const parsed = answersSchema.safeParse(input)
  return parsed.success ? parsed.data : {}
}

function isRecordFieldName(id: string): id is RecordFieldName {
  return Object.hasOwn(RECORD_FIELDS, id)
}

function isCollectionName(id: string): id is CollectionName {
  return Object.hasOwn(COLLECTIONS, id)
}

function collectionField(name: CollectionName, id: string): FieldSpec | undefined {
  const fields: Readonly<Record<string, FieldSpec>> = COLLECTIONS[name].fields
  return Object.hasOwn(fields, id) ? fields[id] : undefined
}

function isList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isEntryList(value: unknown): value is readonly SectionValues[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
  )
}

function unbound(section: FormSection, path: string): never {
  throw new Error(`Section "${section.id}" item "${path}" binds no canonical field.`)
}

function boundRecordField(section: FormSection, id: string): RecordFieldName {
  return isRecordFieldName(id) ? id : unbound(section, id)
}

function boundCollection(section: FormSection, id: string): CollectionName {
  return isCollectionName(id) ? id : unbound(section, id)
}

function boundCollectionField(section: FormSection, name: CollectionName, id: string): FieldSpec {
  return collectionField(name, id) ?? unbound(section, `${name}.${id}`)
}

export function recordScope(section: FormSection): RecordScope {
  const records = new Set<RecordName>()
  const collections = new Set<CollectionName>()
  for (const item of section.items) {
    if (item.kind === 'group') collections.add(boundCollection(section, item.id))
    else records.add(RECORD_FIELDS[boundRecordField(section, item.id)].record)
  }
  return { records: [...records], collections: [...collections] }
}

// `undefined` keeps the kind's blank answer. A sealed number is never pre-filled, and its
// presence value `true` must not become 'yes'.
function rawValue(
  field: FormField,
  type: ValueType,
  value: StoredValue | undefined,
): RawValue | undefined {
  if (value === null || value === undefined || SEALED_TYPES.has(type)) return undefined
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return type === 'money' ? formatCents(value) : String(value)
  if (isList(value) && field.kind === 'nameList') return value.join(', ')
  if (typeof value === 'string' || isList(value)) return value
  return {
    line1: value.line1 ?? '',
    line2: value.line2 ?? '',
    city: value.city ?? '',
    state: value.state ?? '',
    zip: value.zip ?? '',
  }
}

function prefillEntries(
  section: FormSection,
  group: FormGroup,
  stored: StoredRecord,
): readonly RawAnswers[] {
  const name = boundCollection(section, group.id)
  for (const field of group.fields) boundCollectionField(section, name, field.id)

  const entries = (stored.collections[name] ?? []).map((entry) => {
    const answers: Record<string, RawValue> = { ...blankAnswers(group.fields) }
    for (const field of group.fields) {
      const raw = rawValue(field, boundCollectionField(section, name, field.id).type, entry.fields[field.id])
      if (raw !== undefined) answers[field.id] = raw
    }
    answers[ROW_ID_KEY] = entry.rowId
    return answers
  })
  const padding = Array.from({ length: Math.max(0, group.min - entries.length) }, () =>
    blankAnswers(group.fields),
  )
  return [...entries, ...padding]
}

export function prefillSection(section: FormSection, stored: StoredRecord): LoadedSection {
  const answers: Record<string, RawValue> = { ...emptyAnswers(section) }

  const items = section.items.map((item) => {
    if (item.kind === 'group') {
      answers[item.id] = prefillEntries(section, item, stored)
      return item
    }
    const name = boundRecordField(section, item.id)
    const { type } = RECORD_FIELDS[name]
    const value = stored.fields[name]
    const raw = rawValue(item, type, value)
    if (raw !== undefined) answers[item.id] = raw
    // Optional only while a number is on file, so a blank sealed field is "keep it", not "missing".
    if (!SEALED_TYPES.has(type)) return item
    if (typeof value === 'string') {
      return {
        ...item,
        optional: true as const,
        hint: `We have the number ending ${value} on file. Leave this blank to keep it.`,
      }
    }
    return value === true
      ? { ...item, optional: true as const, hint: 'We have this number on file. Leave this blank to keep it.' }
      : item
  })

  return { section: { ...section, items }, answers }
}

export type SealedOnFile = Readonly<Record<string, string | true>>

export function sealedOnFile(section: FormSection, stored: StoredRecord): SealedOnFile {
  const onFile: Record<string, string | true> = {}
  for (const item of section.items) {
    if (item.kind === 'group') continue
    const name = boundRecordField(section, item.id)
    if (!SEALED_TYPES.has(RECORD_FIELDS[name].type)) continue
    const value = stored.fields[name]
    if (typeof value === 'string' || value === true) onFile[item.id] = value
  }
  return onFile
}

const isBlank = (value: string) => value.trim() === ''

// A partial address is saved as a draft. Every non-blank part already passed its part schema,
// or `invalid` would not be empty.
function addressDraft(input: unknown): AddressDraft | null {
  const parsed = rawAddressSchema.safeParse(input)
  if (!parsed.success) return null
  const { line1, line2, city, state, zip } = parsed.data
  if ([line1, line2, city, state, zip].every(isBlank)) return null
  const { shape } = addressSchema
  return {
    line1: isBlank(line1) ? null : shape.line1.parse(line1),
    line2: isBlank(line2) ? null : (shape.line2.parse(line2) ?? null),
    city: isBlank(city) ? null : shape.city.parse(city),
    state: isBlank(state) ? null : shape.state.parse(state),
    zip: isBlank(zip) ? null : shape.zip.parse(zip),
  }
}

// `undefined` = leave the column as stored. A hidden answer is cleared, so no form printed from
// the record carries it; a blank sealed field keeps the number on file; a NOT NULL column never
// gets null.
function fieldPatch(
  field: FormField,
  spec: FieldSpec,
  visible: boolean,
  raw: unknown,
  value: CanonicalValue | undefined,
): PatchValue | undefined {
  if (!visible) return spec.notNull ? undefined : null
  if (spec.type === 'address') return addressDraft(raw)
  if (value === undefined) return SEALED_TYPES.has(spec.type) || spec.notNull ? undefined : null
  if (typeof value !== 'object' || isList(value)) return value
  throw new Error(`Field "${field.id}" produced a value a ${spec.type} column cannot store.`)
}

function anchorOf(name: CollectionName): string {
  const fields: Readonly<Record<string, FieldSpec>> = COLLECTIONS[name].fields
  const anchor = Object.keys(fields).find(
    (id) => fields[id]?.type === 'text' && fields[id]?.notNull === true,
  )
  if (anchor === undefined) throw new Error(`Collection "${name}" has no anchor field.`)
  return anchor
}

function isKeyed(name: CollectionName): boolean {
  return 'keyedByAnchor' in COLLECTIONS[name]
}

// A keyed collection holds one row per anchor value; a repeat would hit the unique index.
function duplicateIssues(section: FormSection, values: SectionValues): Record<string, string> {
  const invalid: Record<string, string> = {}
  for (const item of section.items) {
    if (item.kind !== 'group') continue
    const name = boundCollection(section, item.id)
    if (!isKeyed(name)) continue
    const anchor = anchorOf(name)
    const entries = values[item.id]
    const seen = new Set<CanonicalValue>()
    ;(isEntryList(entries) ? entries : []).forEach((entry, index) => {
      const value = entry[anchor]
      if (value === undefined) return
      if (seen.has(value)) invalid[`${item.id}.${index}.${anchor}`] = 'You have already listed this.'
      seen.add(value)
    })
  }
  return invalid
}

function groupPatch(
  section: FormSection,
  group: FormGroup,
  input: unknown,
  values: CanonicalValue | undefined,
  stored: readonly StoredEntry[],
): { readonly upserts: readonly EntryPatch[]; readonly deletes: readonly string[] } {
  const name = boundCollection(section, group.id)
  const anchor = anchorOf(name)
  const keyed = isKeyed(name)
  const parsed = entriesSchema.safeParse(input)
  const entries = parsed.success ? parsed.data : []
  const entryValues = isEntryList(values) ? values : []
  const storedIds = new Set(stored.map((entry) => entry.rowId))
  const claimed = new Set<string>()
  const upserts: EntryPatch[] = []

  entries.forEach((entryInput, index) => {
    const entry = asAnswers(entryInput)
    const candidate = entry[ROW_ID_KEY]
    const canonical = entryValues[index] ?? {}
    const anchorValue = canonical[anchor]
    // A keyed row is matched by its anchor value, so no update ever changes an anchor: a renamed
    // or swapped value is a delete plus a create, which cannot collide with the unique index.
    // Otherwise a forged, foreign or repeated id becomes a new row, never a write to someone
    // else's row.
    const rowId =
      keyed && anchorValue !== undefined
        ? (stored.find((row) => row.fields[anchor] === anchorValue)?.rowId ?? null)
        : typeof candidate === 'string' && storedIds.has(candidate) && !claimed.has(candidate)
          ? candidate
          : null
    if (rowId !== null) claimed.add(rowId)

    if (anchorValue === undefined) return

    const visible = new Set(visibleItems(group.fields, entry).map((field) => field.id))
    const fields: Record<string, PatchValue> = {}
    for (const field of group.fields) {
      const spec = boundCollectionField(section, name, field.id)
      const value = fieldPatch(field, spec, visible.has(field.id), entry[field.id], canonical[field.id])
      if (value !== undefined) fields[field.id] = value
    }
    upserts.push({ rowId, fields })
  })

  return { upserts, deletes: [...storedIds].filter((id) => !claimed.has(id)) }
}

export function planSave(
  section: FormSection,
  stored: StoredRecord,
  answers: unknown,
  asOf: Date,
): SavePlan {
  const loaded = prefillSection(section, stored)
  const validation = validateSection(loaded.section, answers, asOf)
  const { missing, values } = validation
  const invalid = { ...validation.invalid, ...duplicateIssues(loaded.section, values) }
  if (Object.keys(invalid).length > 0) return { status: 'rejected', issues: { invalid, missing } }

  const raw = asAnswers(answers)
  const visible = new Set(visibleItems(loaded.section.items, raw).map((item) => item.id))
  const fields: Partial<Record<RecordFieldName, PatchValue>> = {}
  const collections: Partial<Record<CollectionName, ReturnType<typeof groupPatch>>> = {}

  for (const item of loaded.section.items) {
    if (item.kind === 'group') {
      const name = boundCollection(section, item.id)
      collections[name] = groupPatch(section, item, raw[item.id], values[item.id], stored.collections[name] ?? [])
      continue
    }
    const name = boundRecordField(section, item.id)
    const value = fieldPatch(item, RECORD_FIELDS[name], visible.has(item.id), raw[item.id], values[item.id])
    if (value !== undefined) fields[name] = value
  }

  return { status: 'accepted', issues: { invalid: {}, missing }, patch: { fields, collections } }
}
