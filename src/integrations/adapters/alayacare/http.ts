import { createHash } from 'node:crypto'
import {
  findProfileInputSchema,
  upsertProfileInputSchema,
  uploadDocumentInputSchema,
  writeCredentialInputSchema,
  writeCustomFieldsInputSchema,
} from '@/integrations/ports/alayacare'
import type { AlayaCarePort, AlayaCareProfile, SyncOutcome } from '@/integrations/ports/alayacare'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import type { StoragePort, StoredObject } from '@/integrations/ports/storage'
import {
  attachmentCreatedSchema,
  employeeListSchema,
  employeeSchema,
  employeeSkillCreatedSchema,
  employeeSkillsSchema,
  employeeWrittenSchema,
  errorSchema,
  profileAttributesSchema,
  skillsSchema,
} from './wire'
import type { Demographics, Employee, EmployeeListItem, EmployeeSkillWrite, EmployeeWrite } from './wire'

const BASE_PATH = '/ext/api/v2/employees'

type WireResponse = { readonly status: number; readonly body: unknown }

type Send = {
  readonly json?: EmployeeWrite | EmployeeSkillWrite
  readonly file?: { readonly data: Uint8Array; readonly contentType: string; readonly filename: string }
}

type Page<T> = { readonly items: readonly T[]; readonly total_pages: number }

function applied<T>(value: T): SyncOutcome<T> {
  return { status: 'applied', value }
}

function rejected(reason: string): SyncOutcome<never> {
  return { status: 'rejected', reason }
}

function unexpected(method: string, path: string, status: number): Error {
  return new Error(`AlayaCare answered an unmodelled ${status} to ${method} ${path}`)
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after')
  return value !== null && /^\d+$/.test(value) ? Number(value) * 1000 : undefined
}

function refusal(response: WireResponse, method: string, path: string): SyncOutcome<never> {
  if (response.status === 400 || response.status === 404) {
    return rejected(`AlayaCare refused ${method} ${path}: ${errorSchema.parse(response.body).message}`)
  }
  throw unexpected(method, path, response.status)
}

function sameName(theirs: string | null, ours: string): boolean {
  return theirs !== null && theirs.trim().toLowerCase() === ours.trim().toLowerCase()
}

function toProfile(employee: Employee): AlayaCareProfile {
  const { demographics } = employee
  if (demographics.birthday == null) throw new Error(`AlayaCare employee ${employee.id} has no date of birth`)
  return {
    externalId: String(employee.id),
    firstName: demographics.first_name,
    lastName: demographics.last_name,
    dateOfBirth: demographics.birthday,
    email: demographics.email ?? null,
    phone: demographics.phone ?? null,
    startDate: demographics.hire_date ?? null,
  }
}

function toDemographics(profile: AlayaCareProfile): Demographics {
  return {
    first_name: profile.firstName,
    last_name: profile.lastName,
    email: profile.email,
    birthday: profile.dateOfBirth,
    phone: profile.phone,
    hire_date: profile.startDate,
  }
}

function employeePath(externalId: string, sub = ''): string {
  return `/employees/${encodeURIComponent(externalId)}${sub}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// The port's idempotencyKey is validated but never sent: AlayaCare has no idempotency header, so
// each write first looks for what an earlier attempt already left behind.
export function createHttpAlayaCare(deps: {
  readonly baseUrl: string
  readonly storage: StoragePort
}): AlayaCarePort {
  const baseUrl = deps.baseUrl.replace(/\/$/, '')

  async function send(agencyId: string, method: string, path: string, payload: Send = {}): Promise<Response> {
    // The public key names the agency's tenant; per-agency API keys are out of scope for now.
    const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${agencyId}:`).toString('base64')}` }
    let body: string | FormData | undefined
    if (payload.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload.json)
    }
    if (payload.file !== undefined) {
      body = new FormData()
      const { data, contentType, filename } = payload.file
      body.append('file', new Blob([new Uint8Array(data)], { type: contentType }), filename)
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}${BASE_PATH}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new VendorUnavailableError(
        'alayacare',
        `AlayaCare at ${baseUrl} did not answer ${method} ${path} (is \`npm run mock:alayacare\` running?): ${String(error)}`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      throw new VendorUnavailableError(
        'alayacare',
        `AlayaCare answered ${response.status} to ${method} ${path}`,
        retryAfterMs(response.headers),
      )
    }
    return response
  }

  async function request(agencyId: string, method: string, path: string, payload: Send = {}): Promise<WireResponse> {
    const response = await send(agencyId, method, path, payload)
    const text = await response.text()
    return { status: response.status, body: text === '' ? null : JSON.parse(text) }
  }

  // Every page of a paginated list; null when AlayaCare answers 404.
  async function listAll<T>(
    agencyId: string,
    path: string,
    schema: { parse(body: unknown): Page<T> },
    query: Record<string, string> = {},
  ): Promise<T[] | null> {
    const items: T[] = []
    for (let page = 1; ; page++) {
      const pagePath = `${path}?${new URLSearchParams({ ...query, page: String(page) }).toString()}`
      const response = await request(agencyId, 'GET', pagePath)
      if (response.status === 404) return null
      if (response.status !== 200) throw unexpected('GET', pagePath, response.status)
      const parsed = schema.parse(response.body)
      items.push(...parsed.items)
      if (page >= parsed.total_pages) return items
    }
  }

  async function getEmployee(agencyId: string, path: string): Promise<Employee | null> {
    const response = await request(agencyId, 'GET', path)
    if (response.status === 404) return null
    if (response.status !== 200) throw unexpected('GET', path, response.status)
    return employeeSchema.parse(response.body)
  }

  // The list filter is a substring search and its items carry no birthday, so matches are
  // narrowed here and each one's detail is read.
  async function namesakes(agencyId: string, lastName: string): Promise<EmployeeListItem[]> {
    const items = await listAll(agencyId, '/employees', employeeListSchema, { filter: lastName.trim() })
    if (items === null) throw unexpected('GET', '/employees', 404)
    return items.filter((item) => sameName(item.last_name, lastName))
  }

  async function details(agencyId: string, items: readonly EmployeeListItem[]): Promise<Employee[]> {
    const employees = await Promise.all(items.map((item) => getEmployee(agencyId, employeePath(String(item.id)))))
    return employees.filter((employee) => employee !== null)
  }

  async function postDocument(
    agencyId: string,
    externalId: string,
    stored: StoredObject,
    folder: string,
    filename: string,
  ): Promise<SyncOutcome<{ readonly documentId: string }>> {
    const filePath = `${folder}/${filename}`
    const path = employeePath(externalId, `/attachments/${folder}/${encodeURIComponent(filename)}`)
    const response = await request(agencyId, 'POST', path, {
      file: { data: stored.bytes, contentType: stored.contentType, filename },
    })
    if (response.status === 201) return applied({ documentId: attachmentCreatedSchema.parse(response.body).name })
    if (response.status !== 409) return refusal(response, 'POST', path)

    // Taken: the same bytes mean an earlier attempt landed; different bytes are someone else's file.
    const existing = await send(agencyId, 'GET', path)
    if (existing.status !== 200) throw unexpected('GET', path, existing.status)
    const theirs = new Uint8Array(await existing.arrayBuffer())
    if (sha256(theirs) === sha256(stored.bytes)) return applied({ documentId: filePath })
    return rejected(`AlayaCare already has a different file at ${filePath}`)
  }

  return {
    async findProfile(input) {
      const { agencyId, lookup } = findProfileInputSchema.parse(input)

      if (lookup.by === 'externalId') {
        const employee = await getEmployee(agencyId, employeePath(lookup.externalId))
        return employee === null ? null : toProfile(employee)
      }

      const matches = (await details(agencyId, await namesakes(agencyId, lookup.lastName))).filter(
        (employee) => employee.demographics.birthday === lookup.dateOfBirth,
      )
      // The port can return one profile or none; an ambiguous match must not pick one silently.
      if (matches.length > 1) {
        throw new Error(
          `AlayaCare agency ${agencyId} has ${matches.length} employees with last name "${lookup.lastName}" and that date of birth`,
        )
      }
      const [only] = matches
      return only === undefined ? null : toProfile(only)
    },

    async upsertProfile(input) {
      const { agencyId, caregiverId, profile } = upsertProfileInputSchema.parse(input)
      const demographics = toDemographics(profile)
      const dateOfBirthConflict = (theirs: string): SyncOutcome<never> => ({
        status: 'conflict',
        conflicts: [{ field: 'dateOfBirth', ours: profile.dateOfBirth, theirs }],
      })

      if (profile.externalId !== null) {
        const path = employeePath(profile.externalId)
        const current = await request(agencyId, 'GET', path)
        if (current.status !== 200) return refusal(current, 'GET', path)
        const theirs = employeeSchema.parse(current.body).demographics.birthday
        if (theirs != null && theirs !== profile.dateOfBirth) return dateOfBirthConflict(theirs)

        const response = await request(agencyId, 'PUT', path, { json: { demographics } })
        if (response.status === 200) return applied({ externalId: String(employeeWrittenSchema.parse(response.body).id) })
        return refusal(response, 'PUT', path)
      }

      // AlayaCare does not check for duplicate people on create, so the name + DOB check is ours.
      const sameNamed = (await namesakes(agencyId, profile.lastName)).filter((item) =>
        sameName(item.first_name, profile.firstName),
      )
      const ours = sameNamed.find((item) => item.external_id === caregiverId)
      if (ours !== undefined) return applied({ externalId: String(ours.id) })
      const existing = await details(agencyId, sameNamed)
      const twin = existing.find((employee) => employee.demographics.birthday === profile.dateOfBirth)
      if (twin !== undefined) {
        return rejected(`AlayaCare already has employee ${twin.id} with this name and date of birth`)
      }
      const theirs = existing.find((employee) => employee.demographics.birthday != null)?.demographics.birthday
      if (theirs != null) return dateOfBirthConflict(theirs)

      const response = await request(agencyId, 'POST', '/employees', { json: { demographics, external_id: caregiverId } })
      if (response.status === 201) return applied({ externalId: String(employeeWrittenSchema.parse(response.body).id) })
      if (response.status === 409) {
        // external_id taken: an earlier create landed but its response was lost.
        const created = await getEmployee(agencyId, `/employees/by_id/${encodeURIComponent(caregiverId)}`)
        if (created !== null) return applied({ externalId: String(created.id) })
      }
      return refusal(response, 'POST', '/employees')
    },

    async writeCredential(input) {
      const { agencyId, externalId, credential } = writeCredentialInputSchema.parse(input)

      const stored = credential.documentKey === null ? null : await deps.storage.read(agencyId, credential.documentKey)
      if (credential.documentKey !== null && stored === null) return rejected(`No stored document at ${credential.documentKey}`)

      const skills = await listAll(agencyId, '/skills', skillsSchema)
      if (skills === null) throw unexpected('GET', '/skills', 404)
      if (!skills.some((skill) => String(skill.id) === credential.code)) {
        return rejected(`AlayaCare has no skill ${credential.code}`)
      }

      let comments: string | undefined
      if (credential.documentKey !== null && stored !== null) {
        const filename = credential.documentKey.slice(credential.documentKey.lastIndexOf('/') + 1)
        const upload = await postDocument(agencyId, externalId, stored, 'Credora/Credentials', filename)
        if (upload.status !== 'applied') return upload
        comments = `Document: ${upload.value.documentId}`
      }

      const skillsPath = `/${encodeURIComponent(externalId)}/skills`
      const held = await listAll(agencyId, skillsPath, employeeSkillsSchema)
      if (held === null) return rejected(`AlayaCare has no employee ${externalId} (GET ${skillsPath})`)
      const expiresAt = credential.expiresOn === null ? null : Date.parse(`${credential.expiresOn}T00:00:00Z`) / 1000
      const earlier = held.find(
        (item) =>
          String(item.skill_id) === credential.code &&
          item.acquired_date_value === credential.issuedOn &&
          item.date_value === expiresAt &&
          item.label_1_value === credential.number &&
          item.label_2_value === credential.issuer,
      )
      if (earlier !== undefined) return applied({ credentialId: String(earlier.id) })

      const path = '/employee_skills'
      const response = await request(agencyId, 'POST', path, {
        json: {
          employee_id: Number(externalId),
          skill_id: Number(credential.code),
          start_at: credential.issuedOn ?? undefined,
          expiry_date: credential.expiresOn === null ? undefined : `${credential.expiresOn}T00:00:00Z`,
          label1: credential.number ?? undefined,
          label2: credential.issuer ?? undefined,
          comments,
        },
      })
      if (response.status === 201) {
        return applied({ credentialId: String(employeeSkillCreatedSchema.parse(response.body).id) })
      }
      return refusal(response, 'POST', path)
    },

    async writeCustomFields(input) {
      const { agencyId, externalId, fields } = writeCustomFieldsInputSchema.parse(input)

      const attributes = await listAll(agencyId, '/profile/employee', profileAttributesSchema)
      if (attributes === null) throw unexpected('GET', '/profile/employee', 404)
      const tags = new Set(attributes.map((attribute) => attribute.tag))
      const unknown = Object.keys(fields).filter((key) => !tags.has(key))
      if (unknown.length > 0) return rejected(`AlayaCare has no employee profile attribute ${unknown.join(', ')}`)

      // Assumed, not documented: PUT merges demographics key by key, so other tags keep their values.
      const path = employeePath(externalId)
      const response = await request(agencyId, 'PUT', path, { json: { demographics: fields } })
      if (response.status === 200) return applied(null)
      return refusal(response, 'PUT', path)
    },

    async uploadDocument(input) {
      const { agencyId, externalId, storageKey, filename } = uploadDocumentInputSchema.parse(input)
      const stored = await deps.storage.read(agencyId, storageKey)
      if (stored === null) return rejected(`No stored document at ${storageKey}`)
      return postDocument(agencyId, externalId, stored, 'Credora', filename)
    },
  }
}
