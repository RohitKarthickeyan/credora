import {
  type LoadedSection,
  type PatchValue,
  type RecordPatch,
  type RecordScope,
  type SectionSaveResult,
  type StoredEntry,
  type StoredRecord,
  type StoredValue,
  planSave,
  prefillSection,
  recordScope,
  sealedOnFile,
} from '@/domain/forms/binding'
import {
  COLLECTIONS,
  type CollectionName,
  RECORD_FIELDS,
  type RecordName,
  type ValueType,
} from '@/domain/forms/canonical-record'
import type { FormSection } from '@/domain/forms/definition'
import type { SectionMissing } from '@/domain/forms/intake-flow'
import { type SectionSummary, summariseSection } from '@/domain/forms/summary'
import { validateSection } from '@/domain/forms/validate'
import { type AuditedTx, runInAuditedTransaction, writeAuditEntry } from '../audit'
import type { CareSettingExperienceModel } from '../generated/models/CareSettingExperience'
import type { ContactRecordModel } from '../generated/models/ContactRecord'
import type { EducationEntryModel } from '../generated/models/EducationEntry'
import type { EmergencyContactModel } from '../generated/models/EmergencyContact'
import type { EmploymentEntryModel } from '../generated/models/EmploymentEntry'
import type { HomeCareProfileModel } from '../generated/models/HomeCareProfile'
import type { IdentityRecordModel } from '../generated/models/IdentityRecord'
import type { PayrollInputsModel } from '../generated/models/PayrollInputs'
import type { ReferenceModel } from '../generated/models/Reference'
import { type PartialAddress, toAddressColumns, toPartialAddressColumns } from '../mapping/address'
import { fromDateColumn, toDateColumn } from '../mapping/date-only'
import { satelliteKey } from '../mapping/scope'
import {
  type IdentityRecordSealedRow,
  type PayrollInputsSealedRow,
  identityRecordSealedSelect,
  payrollInputsSealedSelect,
} from '../mapping/selects'
import {
  toBankAccountNumberColumns,
  toBankRoutingNumberColumns,
  toSsnColumns,
  toWorkAuthorizationNumberColumns,
} from '../mapping/sensitive'

type Column = string | number | boolean | Date | readonly string[] | null | undefined
type ColumnRow = { readonly [column: string]: Column }
type EntryRow = ColumnRow & { readonly id: string }
type Columns = Record<string, unknown>
type Specs = Readonly<Record<string, { readonly type: ValueType }>>

function recordSpecs(record: RecordName): Specs {
  return Object.fromEntries(Object.entries(RECORD_FIELDS).filter(([, spec]) => spec.record === record))
}

function collectionSpecs(name: CollectionName): Specs {
  return COLLECTIONS[name].fields
}

const text = (value: Column): string | null => (typeof value === 'string' ? value : null)

function storedValue(row: ColumnRow | null, name: string, type: ValueType): StoredValue {
  if (row === null) return null
  // The envelope is never selected on this path; the last four stand for "on file".
  if (type === 'ssn') return text(row.ssnLast4)
  if (type === 'accountNumber') return text(row.bankAccountLast4)
  // No last-four column: readRecord projects presence under the field's own name.
  if (type === 'routingNumber' || type === 'documentNumber') return row[name] === true ? true : null
  if (type === 'address') {
    return {
      line1: text(row.line1),
      line2: text(row.line2),
      city: text(row.city),
      state: text(row.state),
      zip: text(row.zip),
    }
  }
  const value = row[name]
  if (value === undefined) return null
  // Every bound Date column is @db.Date.
  return value instanceof Date ? fromDateColumn(value) : value
}

// Presence of an envelope with no last-four column is `IS NOT NULL` projected in Postgres, so
// the ciphertext never leaves the database and is never filtered on (ADR-066).
async function readRecord(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  record: RecordName,
): Promise<ColumnRow | null> {
  const where = satelliteKey(agencyId, caregiverId)
  switch (record) {
    case 'identity': {
      const row: IdentityRecordSealedRow | null = await tx.identityRecord.findUnique({
        where,
        select: identityRecordSealedSelect,
      })
      if (row === null) return null
      const [presence] = await tx.$queryRaw<{ workAuthorizationNumber: boolean }[]>`
        SELECT ("workAuthorizationNumberEnc" IS NOT NULL) AS "workAuthorizationNumber"
        FROM "core"."IdentityRecord"
        WHERE "agencyId" = ${agencyId} AND "caregiverId" = ${caregiverId}`
      return { ...row, workAuthorizationNumber: presence?.workAuthorizationNumber ?? false }
    }
    case 'contact':
      return tx.contactRecord.findUnique({ where })
    case 'homeCareProfile':
      return tx.homeCareProfile.findUnique({ where })
    case 'payrollInputs': {
      const row: PayrollInputsSealedRow | null = await tx.payrollInputs.findUnique({
        where,
        select: payrollInputsSealedSelect,
      })
      if (row === null) return null
      const [presence] = await tx.$queryRaw<{ bankRoutingNumber: boolean }[]>`
        SELECT ("bankRoutingNumberEnc" IS NOT NULL) AS "bankRoutingNumber"
        FROM "core"."PayrollInputs"
        WHERE "agencyId" = ${agencyId} AND "caregiverId" = ${caregiverId}`
      return { ...row, bankRoutingNumber: presence?.bankRoutingNumber ?? false }
    }
  }
}

// uuidv7 ids sort in creation order, which is the order the caregiver entered them.
function readEntries(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  name: CollectionName,
): Promise<readonly EntryRow[]> {
  const query = { where: { agencyId, caregiverId }, orderBy: { id: 'asc' } } as const
  switch (name) {
    case 'employment':
      return tx.employmentEntry.findMany(query)
    case 'education':
      return tx.educationEntry.findMany(query)
    case 'references':
      return tx.reference.findMany(query)
    case 'emergencyContacts':
      return tx.emergencyContact.findMany(query)
    case 'careSettingExperience':
      return tx.careSettingExperience.findMany(query)
  }
}

async function readStored(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  scope: RecordScope,
): Promise<StoredRecord> {
  const fields: Record<string, StoredValue> = {}
  for (const record of scope.records) {
    const row = await readRecord(tx, agencyId, caregiverId, record)
    for (const [name, spec] of Object.entries(recordSpecs(record))) {
      fields[name] = storedValue(row, name, spec.type)
    }
  }

  const collections: Partial<Record<CollectionName, readonly StoredEntry[]>> = {}
  for (const name of scope.collections) {
    const specs = Object.entries(collectionSpecs(name))
    const rows = await readEntries(tx, agencyId, caregiverId, name)
    collections[name] = rows.map((row) => ({
      rowId: row.id,
      fields: Object.fromEntries(specs.map(([field, spec]) => [field, storedValue(row, field, spec.type)])),
    }))
  }

  return { fields, collections }
}

function isAddress(value: PatchValue): value is PartialAddress {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function columnsFor(name: string, type: ValueType, value: PatchValue): Columns {
  switch (type) {
    case 'ssn':
      return toSsnColumns(typeof value === 'string' ? value : null)
    case 'accountNumber':
      return toBankAccountNumberColumns(typeof value === 'string' ? value : null)
    case 'routingNumber':
      return toBankRoutingNumberColumns(typeof value === 'string' ? value : null)
    case 'documentNumber':
      return toWorkAuthorizationNumberColumns(typeof value === 'string' ? value : null)
    case 'address':
      return isAddress(value) ? toPartialAddressColumns(value) : toAddressColumns(null)
    case 'date':
      return { [name]: toDateColumn(typeof value === 'string' ? value : null) }
    case 'textList':
      // A list column is NOT NULL: an erased list is empty.
      return { [name]: value ?? [] }
    default:
      return { [name]: value }
  }
}

function toColumns(specs: Specs, values: Readonly<Record<string, PatchValue | undefined>>): Columns {
  const columns: Columns = {}
  for (const [name, spec] of Object.entries(specs)) {
    const value = values[name]
    if (value !== undefined) Object.assign(columns, columnsFor(name, spec.type, value))
  }
  return columns
}

// One `as` per model: the cast relies on the catalogue's column names and types matching each
// model, which nothing checks, so change them together.
async function writeRecord(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  record: RecordName,
  columns: Columns,
): Promise<void> {
  const where = satelliteKey(agencyId, caregiverId)
  const scope = { agencyId, caregiverId }
  switch (record) {
    case 'identity': {
      const data = columns as Partial<IdentityRecordModel>
      await tx.identityRecord.upsert({ where, create: { ...data, ...scope }, update: data })
      return
    }
    case 'contact': {
      const data = columns as Partial<ContactRecordModel>
      await tx.contactRecord.upsert({ where, create: { ...data, ...scope }, update: data })
      return
    }
    case 'homeCareProfile': {
      const data = columns as Partial<HomeCareProfileModel>
      await tx.homeCareProfile.upsert({ where, create: { ...data, ...scope }, update: data })
      return
    }
    case 'payrollInputs': {
      const data = columns as Partial<PayrollInputsModel>
      await tx.payrollInputs.upsert({ where, create: { ...data, ...scope }, update: data })
      return
    }
  }
}

async function deleteEntries(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  name: CollectionName,
  ids: readonly string[],
): Promise<void> {
  const where = { agencyId, caregiverId, id: { in: [...ids] } }
  switch (name) {
    case 'employment':
      await tx.employmentEntry.deleteMany({ where })
      return
    case 'education':
      await tx.educationEntry.deleteMany({ where })
      return
    case 'references':
      await tx.reference.deleteMany({ where })
      return
    case 'emergencyContacts':
      await tx.emergencyContact.deleteMany({ where })
      return
    case 'careSettingExperience':
      await tx.careSettingExperience.deleteMany({ where })
      return
  }
}

// An upsert always carries its anchor: planSave never emits an entry without one.
async function writeEntry(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  name: CollectionName,
  rowId: string | null,
  columns: Columns,
): Promise<void> {
  const scope = { agencyId, caregiverId }
  switch (name) {
    case 'employment': {
      const data = columns as Partial<EmploymentEntryModel> & Pick<EmploymentEntryModel, 'employerName'>
      if (rowId === null) await tx.employmentEntry.create({ data: { ...data, ...scope } })
      else await tx.employmentEntry.updateMany({ where: { ...scope, id: rowId }, data })
      return
    }
    case 'education': {
      const data = columns as Partial<EducationEntryModel> & Pick<EducationEntryModel, 'schoolName'>
      if (rowId === null) await tx.educationEntry.create({ data: { ...data, ...scope } })
      else await tx.educationEntry.updateMany({ where: { ...scope, id: rowId }, data })
      return
    }
    case 'references': {
      const data = columns as Partial<ReferenceModel> & Pick<ReferenceModel, 'fullName'>
      if (rowId === null) await tx.reference.create({ data: { ...data, ...scope } })
      else await tx.reference.updateMany({ where: { ...scope, id: rowId }, data })
      return
    }
    case 'emergencyContacts': {
      const data = columns as Partial<EmergencyContactModel> & Pick<EmergencyContactModel, 'fullName'>
      if (rowId === null) await tx.emergencyContact.create({ data: { ...data, ...scope } })
      else await tx.emergencyContact.updateMany({ where: { ...scope, id: rowId }, data })
      return
    }
    case 'careSettingExperience': {
      const data = columns as Partial<CareSettingExperienceModel> &
        Pick<CareSettingExperienceModel, 'setting'>
      if (rowId === null) await tx.careSettingExperience.create({ data: { ...data, ...scope } })
      else await tx.careSettingExperience.updateMany({ where: { ...scope, id: rowId }, data })
      return
    }
  }
}

async function writePatch(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  scope: RecordScope,
  patch: RecordPatch,
): Promise<void> {
  // A satellite is created only when a save writes to it.
  for (const record of scope.records) {
    const columns = toColumns(recordSpecs(record), patch.fields)
    if (Object.keys(columns).length > 0) await writeRecord(tx, agencyId, caregiverId, record, columns)
  }

  for (const name of scope.collections) {
    const change = patch.collections[name]
    if (change === undefined) continue
    if (change.deletes.length > 0) await deleteEntries(tx, agencyId, caregiverId, name, change.deletes)
    // Sequential, so new rows' ids — hence load order — follow the caregiver's order.
    for (const upsert of change.upserts) {
      const columns = toColumns(collectionSpecs(name), upsert.fields)
      await writeEntry(tx, agencyId, caregiverId, name, upsert.rowId, columns)
    }
  }
}

export function loadSectionAnswers(
  agencyId: string,
  caregiverId: string,
  section: FormSection,
): Promise<LoadedSection> {
  return runInAuditedTransaction(async (tx) => {
    const stored = await readStored(tx, agencyId, caregiverId, recordScope(section))
    // One entry per load, no field names and no values (SECURITY.md § Audit log).
    await writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: caregiverId })
    return prefillSection(section, stored)
  })
}

export function loadSectionsMissing(
  agencyId: string,
  caregiverId: string,
  sections: readonly FormSection[],
  asOf: Date,
): Promise<Readonly<Record<string, SectionMissing>>> {
  return runInAuditedTransaction(async (tx) => {
    const missing: Record<string, SectionMissing> = {}
    for (const section of sections) {
      const loaded = prefillSection(section, await readStored(tx, agencyId, caregiverId, recordScope(section)))
      missing[section.id] = validateSection(loaded.section, loaded.answers, asOf).missing
    }
    await writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: caregiverId })
    return missing
  })
}

export function loadSectionSummaries(
  agencyId: string,
  caregiverId: string,
  sections: readonly FormSection[],
): Promise<Readonly<Record<string, SectionSummary>>> {
  return runInAuditedTransaction(async (tx) => {
    const summaries: Record<string, SectionSummary> = {}
    for (const section of sections) {
      const stored = await readStored(tx, agencyId, caregiverId, recordScope(section))
      summaries[section.id] = summariseSection(prefillSection(section, stored), sealedOnFile(section, stored))
    }
    await writeAuditEntry(tx, { agencyId, action: 'VIEW', entityType: 'CAREGIVER', entityId: caregiverId })
    return summaries
  })
}

export function saveSectionAnswers(
  agencyId: string,
  caregiverId: string,
  section: FormSection,
  answers: unknown,
  asOf: Date,
): Promise<SectionSaveResult> {
  return runInAuditedTransaction(async (tx) => {
    const scope = recordScope(section)
    const plan = planSave(section, await readStored(tx, agencyId, caregiverId, scope), answers, asOf)
    if (plan.status === 'rejected') return { ...plan.issues, saved: false }

    await writePatch(tx, agencyId, caregiverId, scope, plan.patch)
    await writeAuditEntry(tx, { agencyId, action: 'EDIT', entityType: 'CAREGIVER', entityId: caregiverId })
    return { ...plan.issues, saved: true }
  })
}
