import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  findProfileInputSchema,
  upsertProfileInputSchema,
  uploadDocumentInputSchema,
  writeCredentialInputSchema,
  writeCustomFieldsInputSchema,
} from '@/integrations/ports/alayacare'
import type { AlayaCarePort, SyncOutcome } from '@/integrations/ports/alayacare'
import { parseStorageKey } from '@/integrations/ports/storage'
import type { StoragePort } from '@/integrations/ports/storage'
import { env } from '@/lib/env'

// Column names reuse http.ts's wire names; they are invented (ADR-048), so if AlayaCare's import
// template differs only these constants change.
const EMPLOYEE_COLUMNS = [
  'employee_reference',
  'credora_caregiver_id',
  'first_name',
  'last_name',
  'birthday',
  'email',
  'phone',
  'hire_date',
] as const
const CREDENTIAL_COLUMNS = [
  'employee_reference',
  'type_code',
  'number',
  'issuer',
  'issue_date',
  'expiry_date',
  'document_file',
] as const
const DOCUMENT_COLUMNS = ['employee_reference', 'filename', 'document_file'] as const

const cellSchema = z.string().nullable()

const stateSchema = z.object({
  employees: z.array(
    z.object({
      employee_reference: z.string(),
      credora_caregiver_id: z.string(),
      first_name: z.string(),
      last_name: z.string(),
      birthday: z.string(),
      email: cellSchema,
      phone: cellSchema,
      hire_date: cellSchema,
    }),
  ),
  credentials: z.array(
    z.object({
      employee_reference: z.string(),
      type_code: z.string(),
      number: cellSchema,
      issuer: cellSchema,
      issue_date: cellSchema,
      expiry_date: cellSchema,
      document_file: cellSchema,
    }),
  ),
  documents: z.array(z.object({ employee_reference: z.string(), filename: z.string(), document_file: z.string() })),
  customFieldColumns: z.array(z.string()),
  customFields: z.array(z.object({ employee_reference: z.string(), values: z.record(z.string(), z.string()) })),
})
type ExportState = z.infer<typeof stateSchema>

const EMPTY_STATE: ExportState = { employees: [], credentials: [], documents: [], customFieldColumns: [], customFields: [] }

function applied<T>(value: T): SyncOutcome<T> {
  return { status: 'applied', value }
}

function rejected(reason: string): SyncOutcome<never> {
  return { status: 'rejected', reason }
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENOENT'
}

// Caregivers type these values and staff open the files in a spreadsheet: a leading formula
// character is neutralised, but a phone such as "+1 (555) 010-0100" is left as typed.
function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const first = value.charAt(0)
  const formula =
    first === '=' || first === '@' || first === '\t' || first === '\r' || ((first === '+' || first === '-') && /[^0-9 +\-().]/.test(value))
  const guarded = formula ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

function renderCsv(columns: readonly string[], rows: readonly (readonly (string | null | undefined)[])[]): string {
  return [columns, ...rows].map((row) => `${row.map(csvCell).join(',')}\r\n`).join('')
}

function documentFile(storageKey: string): string {
  const parts = parseStorageKey(storageKey)
  if (parts === null) throw new Error('Expected a parsed storage key')
  return `documents/${parts.objectId}.${parts.extension}`
}

async function writeAtomically(file: string, data: string | Uint8Array): Promise<void> {
  await writeFile(`${file}.tmp`, data)
  await rename(`${file}.tmp`, file)
}

export function createExportAlayaCare(deps: {
  readonly storage: StoragePort
  /** Tests pass a tmp dir. Production uses path.join(env.STORAGE_ROOT, '_alayacare-export'). */
  readonly exportRoot?: string
}): AlayaCarePort {
  const exportRoot = deps.exportRoot ?? path.join(env.STORAGE_ROOT, '_alayacare-export')

  async function load(agencyId: string): Promise<ExportState> {
    let text: string
    try {
      text = await readFile(path.join(exportRoot, agencyId, 'export-state.json'), 'utf8')
    } catch (error) {
      if (isNotFound(error)) return EMPTY_STATE
      throw error
    }
    const parsed = stateSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new Error(`The AlayaCare export state for agency ${agencyId} does not parse`)
    return parsed.data
  }

  // One writer is assumed: the single worker drains jobs one at a time (ADR-089, ADR-154).
  async function update(agencyId: string, change: (state: ExportState) => ExportState): Promise<void> {
    const state = change(await load(agencyId))
    const dir = path.join(exportRoot, agencyId)
    await mkdir(dir, { recursive: true })
    await writeAtomically(path.join(dir, 'export-state.json'), JSON.stringify(state))
    await writeAtomically(
      path.join(dir, 'employees.csv'),
      renderCsv(EMPLOYEE_COLUMNS, state.employees.map((row) => EMPLOYEE_COLUMNS.map((column) => row[column]))),
    )
    await writeAtomically(
      path.join(dir, 'credentials.csv'),
      renderCsv(CREDENTIAL_COLUMNS, state.credentials.map((row) => CREDENTIAL_COLUMNS.map((column) => row[column]))),
    )
    await writeAtomically(
      path.join(dir, 'documents.csv'),
      renderCsv(DOCUMENT_COLUMNS, state.documents.map((row) => DOCUMENT_COLUMNS.map((column) => row[column]))),
    )
    await writeAtomically(
      path.join(dir, 'custom-fields.csv'),
      renderCsv(
        ['employee_reference', ...state.customFieldColumns],
        state.customFields.map((row) => [
          row.employee_reference,
          ...state.customFieldColumns.map((key) => (Object.hasOwn(row.values, key) ? row.values[key] : null)),
        ]),
      ),
    )
  }

  async function copyDocument(agencyId: string, storageKey: string): Promise<string | null> {
    const stored = await deps.storage.read(agencyId, storageKey)
    if (stored === null) return null
    const file = documentFile(storageKey)
    await mkdir(path.join(exportRoot, agencyId, 'documents'), { recursive: true })
    await writeAtomically(path.join(exportRoot, agencyId, file), stored.bytes)
    return file
  }

  return {
    async findProfile(input) {
      findProfileInputSchema.parse(input)
      return null
    },

    async upsertProfile(input) {
      const { agencyId, caregiverId, profile } = upsertProfileInputSchema.parse(input)
      const reference = profile.externalId ?? `credora-${caregiverId}`
      const row: ExportState['employees'][number] = {
        employee_reference: reference,
        credora_caregiver_id: caregiverId,
        first_name: profile.firstName,
        last_name: profile.lastName,
        birthday: profile.dateOfBirth,
        email: profile.email,
        phone: profile.phone,
        hire_date: profile.startDate,
      }
      await update(agencyId, (state) => {
        const index = state.employees.findIndex((employee) => employee.employee_reference === reference)
        return {
          ...state,
          employees: index === -1 ? [...state.employees, row] : state.employees.map((employee, i) => (i === index ? row : employee)),
        }
      })
      return applied({ externalId: reference })
    },

    async writeCredential(input) {
      const { agencyId, externalId, credential } = writeCredentialInputSchema.parse(input)
      let file: string | null = null
      if (credential.documentKey !== null) {
        file = await copyDocument(agencyId, credential.documentKey)
        if (file === null) return rejected(`No stored document at ${credential.documentKey}`)
      }
      const row: ExportState['credentials'][number] = {
        employee_reference: externalId,
        type_code: credential.code,
        number: credential.number,
        issuer: credential.issuer,
        issue_date: credential.issuedOn,
        expiry_date: credential.expiresOn,
        document_file: file,
      }
      await update(agencyId, (state) =>
        state.credentials.some((existing) => CREDENTIAL_COLUMNS.every((column) => existing[column] === row[column]))
          ? state
          : { ...state, credentials: [...state.credentials, row] },
      )
      return applied({ credentialId: null })
    },

    async writeCustomFields(input) {
      const { agencyId, externalId, fields } = writeCustomFieldsInputSchema.parse(input)
      await update(agencyId, (state) => {
        const existing = state.customFields.find((row) => row.employee_reference === externalId)
        const merged = { employee_reference: externalId, values: { ...existing?.values, ...fields } }
        return {
          ...state,
          customFieldColumns: [
            ...state.customFieldColumns,
            ...Object.keys(fields).filter((key) => !state.customFieldColumns.includes(key)),
          ],
          customFields:
            existing === undefined
              ? [...state.customFields, merged]
              : state.customFields.map((row) => (row === existing ? merged : row)),
        }
      })
      return applied(null)
    },

    async uploadDocument(input) {
      const { agencyId, externalId, storageKey, filename } = uploadDocumentInputSchema.parse(input)
      const file = await copyDocument(agencyId, storageKey)
      if (file === null) return rejected(`No stored document at ${storageKey}`)
      const row: ExportState['documents'][number] = { employee_reference: externalId, filename, document_file: file }
      await update(agencyId, (state) =>
        state.documents.some((existing) => DOCUMENT_COLUMNS.every((column) => existing[column] === row[column]))
          ? state
          : { ...state, documents: [...state.documents, row] },
      )
      return applied({ documentId: file })
    },
  }
}
