import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buffer } from 'node:stream/consumers'
import { z } from 'zod'
import { SEED } from './seed'
import { employeeCreateSchema, employeeSkillCreateSchema, employeeUpdateSchema } from './wire'
import type { ProfileAttribute, Skill } from './wire'

type FaultSchedule = {
  /** Every Nth request (1-based, counted per server process) answers 429. null = never. */
  readonly rateLimitEvery: number | null
  /** Every Nth request answers 503. null = never. 429 wins when both fire. */
  readonly unavailableEvery: number | null
}

export const DEFAULT_FAULT_SCHEDULE: FaultSchedule = { rateLimitEvery: 7, unavailableEvery: 11 }

type RunningAlayaCareMock = {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  readonly baseUrl: string
  close(): Promise<void>
}

type Reply = {
  readonly status: number
  readonly body?: unknown
  readonly bytes?: Uint8Array
  readonly headers?: Readonly<Record<string, string>>
}

type Attachment = { readonly bytes: Uint8Array; readonly contentType: string; readonly uploadedAt: Date }

type EmployeeRecord = {
  readonly id: number
  external_id: string | null
  readonly status: string
  readonly demographics: Map<string, string>
  readonly attachments: Map<string, Attachment>
}

type EmployeeSkill = {
  readonly id: number
  readonly employee_id: number
  readonly skill: Skill
  readonly start_at: string | null
  readonly expiry_date: string | null
  readonly label1: string | null
  readonly label2: string | null
  readonly label3: string | null
  readonly comments: string | null
}

type Tenant = {
  readonly employees: Map<number, EmployeeRecord>
  readonly employeeSkills: Map<number, EmployeeSkill>
  nextEmployeeId: number
  nextEmployeeSkillId: number
}

type MockRequest = {
  readonly method: string
  readonly url: URL
  readonly headers: IncomingMessage['headers']
  readonly body: Buffer
}

type Result<T> = { ok: true; value: T } | { ok: false; reply: Reply }

const BASE_PATH = '/ext/api/v2/employees'
const REQUIRED_TAGS = ['first_name', 'last_name', 'email'] as const
const HEADQUARTERS = { id: 1, name: 'Headquarters' }
const DATE_LABEL = 'Expiry Date'
const ACQUIRED_DATE_LABEL = 'Issue Date'

// Assumed, not documented: the values each profile attribute type accepts.
const attributeValue: Record<ProfileAttribute['type'], z.ZodType<string>> = {
  text: z.string().min(1).max(255),
  date: z.iso.date(),
  boolean: z.enum(['true', 'false']),
}

function error(status: number, message: string): Reply {
  return { status, body: { code: status, message } }
}

const notFound = error(404, 'Not found')
const employeeNotFound = error(404, 'Employee not found')

function seededTenant(): Tenant {
  return {
    employees: new Map(
      SEED.employees.map((e) => [
        e.id,
        {
          id: e.id,
          external_id: e.external_id,
          status: e.status,
          demographics: new Map(Object.entries(e.demographics)),
          attachments: new Map(),
        },
      ]),
    ),
    employeeSkills: new Map(),
    nextEmployeeId: 1003,
    nextEmployeeSkillId: 1,
  }
}

function positiveInt(url: URL, name: string, fallback: number): number {
  const n = Number(url.searchParams.get(name))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function paginate(items: readonly unknown[], url: URL): Reply {
  const page = positiveInt(url, 'page', 1)
  // Assumed, not documented: the default page size.
  const count = positiveInt(url, 'count', 20)
  const pageItems = items.slice((page - 1) * count, page * count)
  return {
    status: 200,
    body: { items: pageItems, count: pageItems.length, page, total_pages: Math.max(1, Math.ceil(items.length / count)) },
  }
}

function parseJson<T>(schema: z.ZodType<T>, body: Buffer): Result<T> {
  let raw: unknown
  try {
    raw = JSON.parse(body.toString('utf8'))
  } catch {
    return { ok: false, reply: error(400, 'Request body is not valid JSON') }
  }
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, reply: error(400, `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`) }
}

// Assumed, not documented: demographics merge key by key, and null clears a tag.
function mergeDemographics(
  stored: ReadonlyMap<string, string>,
  changes: Readonly<Record<string, unknown>>,
): Result<Map<string, string>> {
  const merged = new Map(stored)
  for (const [tag, value] of Object.entries(changes)) {
    const attribute = SEED.profileAttributes.find((a) => a.tag === tag)
    if (attribute === undefined) return { ok: false, reply: error(400, `Unknown profile attribute: ${tag}`) }
    if (value === null) {
      merged.delete(tag)
      continue
    }
    const parsed = (tag === 'email' ? z.email() : attributeValue[attribute.type]).safeParse(value)
    if (!parsed.success) return { ok: false, reply: error(400, `Invalid value for ${tag}`) }
    merged.set(tag, parsed.data)
  }
  const missing = REQUIRED_TAGS.find((tag) => !merged.has(tag))
  return missing === undefined ? { ok: true, value: merged } : { ok: false, reply: error(400, `${missing} is required`) }
}

function acId(id: number): string {
  return `AC${String(id).padStart(9, '0')}`
}

function profileId(id: number): number {
  return 7000 + id
}

function byId(tenant: Tenant, raw: string | undefined): EmployeeRecord | undefined {
  return raw !== undefined && /^\d+$/.test(raw) ? tenant.employees.get(Number(raw)) : undefined
}

function byExternalId(tenant: Tenant, externalId: string | undefined): EmployeeRecord | undefined {
  return [...tenant.employees.values()].find((e) => externalId !== undefined && e.external_id === externalId)
}

function externalIdTaken(tenant: Tenant, externalId: string, self: number | null): Reply | null {
  const holder = byExternalId(tenant, externalId)
  return holder !== undefined && holder.id !== self
    ? error(409, `Employee already exists with external ID: ${externalId}`)
    : null
}

function listEmployees(tenant: Tenant, url: URL): Reply {
  // Assumed, not documented: `filter` is a case-insensitive substring match on any profile value.
  const filter = url.searchParams.get('filter')?.toLowerCase() ?? ''
  const statuses = url.searchParams.getAll('status')
  const items = [...tenant.employees.values()]
    .filter((e) => statuses.length === 0 || statuses.includes(e.status))
    .filter((e) => filter === '' || [...e.demographics.values()].some((v) => v.toLowerCase().includes(filter)))
    .sort((a, b) => a.id - b.id)
    .map((e) => ({
      id: e.id,
      ac_id: acId(e.id),
      external_id: e.external_id,
      profile_id: profileId(e.id),
      first_name: e.demographics.get('first_name'),
      last_name: e.demographics.get('last_name'),
      status: e.status,
      job_title: null,
      email: e.demographics.get('email'),
      phone: e.demographics.get('phone') ?? null,
      phone_other: null,
      designation: null,
      departments: [],
      _link: `${BASE_PATH}/employees/${e.id}`,
      branch: HEADQUARTERS,
    }))
  return paginate(items, url)
}

function employeeDetail(tenant: Tenant, e: EmployeeRecord): Reply {
  const demographics = Object.fromEntries(
    SEED.profileAttributes.flatMap(({ tag }) => {
      const value = e.demographics.get(tag)
      return value === undefined ? [] : [[tag, value]]
    }),
  )
  const skills = [...tenant.employeeSkills.values()]
    .filter((s) => s.employee_id === e.id)
    .map((s) => ({ id: s.id, name: s.skill.description }))
  return {
    status: 200,
    body: {
      id: e.id,
      ac_id: acId(e.id),
      external_id: e.external_id,
      profile_id: profileId(e.id),
      branch_id: HEADQUARTERS.id,
      status: e.status,
      demographics,
      roles: [],
      groups: [],
      departments: [],
      designation: null,
      skills,
      contacts: [],
      timezone: 'America/New_York',
    },
  }
}

function createEmployee(tenant: Tenant, body: Buffer): Reply {
  const parsed = parseJson(employeeCreateSchema, body)
  if (!parsed.ok) return parsed.reply
  const demographics = mergeDemographics(new Map(), parsed.value.demographics)
  if (!demographics.ok) return demographics.reply
  const externalId = parsed.value.external_id ?? null
  const taken = externalId === null ? null : externalIdTaken(tenant, externalId, null)
  if (taken !== null) return taken

  const id = tenant.nextEmployeeId
  tenant.nextEmployeeId += 1
  // Assumed, not documented: a new employee starts as `pending`.
  tenant.employees.set(id, {
    id,
    external_id: externalId,
    status: 'pending',
    demographics: demographics.value,
    attachments: new Map(),
  })
  return { status: 201, body: { id, external_id: externalId } }
}

function updateEmployee(tenant: Tenant, e: EmployeeRecord, body: Buffer): Reply {
  const parsed = parseJson(employeeUpdateSchema, body)
  if (!parsed.ok) return parsed.reply
  const demographics = mergeDemographics(e.demographics, parsed.value.demographics ?? {})
  if (!demographics.ok) return demographics.reply
  const externalId = parsed.value.external_id
  const taken = externalId === undefined || externalId === null ? null : externalIdTaken(tenant, externalId, e.id)
  if (taken !== null) return taken

  e.demographics.clear()
  for (const [tag, value] of demographics.value) e.demographics.set(tag, value)
  if (externalId !== undefined) e.external_id = externalId
  return { status: 200, body: { id: e.id, external_id: e.external_id } }
}

function skillItem(s: Skill): unknown {
  return {
    id: s.id,
    description: s.description,
    category_id: 1,
    branch_id: HEADQUARTERS.id,
    is_client_specific: false,
    has_date: s.has_date,
    date_label: DATE_LABEL,
    has_acquired_date: s.has_acquired_date,
    acquired_date_label: ACQUIRED_DATE_LABEL,
    has_label1: true,
    label1: s.label1,
    has_label2: true,
    label2: s.label2,
    has_label3: false,
    label3: null,
  }
}

function createEmployeeSkill(tenant: Tenant, body: Buffer): Reply {
  const parsed = parseJson(employeeSkillCreateSchema, body)
  if (!parsed.ok) return parsed.reply
  const write = parsed.value
  if (!tenant.employees.has(write.employee_id)) return error(400, `Unknown employee_id: ${write.employee_id}`)
  const skill = SEED.skills.find((s) => s.id === write.skill_id)
  if (skill === undefined) return error(400, `Unknown skill_id: ${write.skill_id}`)

  const id = tenant.nextEmployeeSkillId
  tenant.nextEmployeeSkillId += 1
  tenant.employeeSkills.set(id, {
    id,
    employee_id: write.employee_id,
    skill,
    start_at: write.start_at ?? null,
    expiry_date: write.expiry_date ?? null,
    label1: write.label1 ?? null,
    label2: write.label2 ?? null,
    label3: write.label3 ?? null,
    comments: write.comments ?? null,
  })
  return { status: 201, body: { id, uri: `/employee_skills/${id}`, type: 'EmployeeSkill' } }
}

function employeeSkill(tenant: Tenant, raw: string): Reply {
  const s = /^\d+$/.test(raw) ? tenant.employeeSkills.get(Number(raw)) : undefined
  if (s === undefined) return error(404, 'Employee skill not found')
  const { skill, ...stored } = s
  return {
    status: 200,
    body: { ...stored, skill_id: skill.id, status: 1, skill: { id: skill.id, description: skill.description } },
  }
}

function employeeSkillsView(tenant: Tenant, e: EmployeeRecord, url: URL): Reply {
  const items = [...tenant.employeeSkills.values()]
    .filter((s) => s.employee_id === e.id)
    .map((s) => ({
      id: s.id,
      skill_id: s.skill.id,
      description: s.skill.description,
      status: 'Active',
      comments: s.comments,
      date_label: DATE_LABEL,
      date_value: s.expiry_date === null ? null : Date.parse(s.expiry_date) / 1000,
      acquired_date_label: ACQUIRED_DATE_LABEL,
      acquired_date_value: s.start_at,
      label_1: s.skill.label1,
      label_1_value: s.label1,
      label_2: s.skill.label2,
      label_2_value: s.label2,
      label_3: null,
      label_3_value: s.label3,
    }))
  return paginate(items, url)
}

async function uploadedFile(request: MockRequest): Promise<File | null> {
  const form = await new Request('http://alayacare.mock', {
    method: 'POST',
    headers: { 'content-type': request.headers['content-type'] ?? '' },
    body: new Uint8Array(request.body),
  })
    .formData()
    .catch(() => null)
  const file = form?.get('file')
  return file instanceof File && file.size > 0 ? file : null
}

async function uploadAttachment(e: EmployeeRecord, path: string, request: MockRequest): Promise<Reply> {
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return error(400, 'Invalid file name')
  const file = await uploadedFile(request)
  if (file === null) return error(400, 'Could not find a file to upload')
  if (e.attachments.has(path)) return error(409, `File "${path}" already exists`)

  e.attachments.set(path, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    // Assumed, not documented: a part without a type is stored as application/octet-stream.
    contentType: file.type === '' ? 'application/octet-stream' : file.type,
    uploadedAt: new Date(),
  })
  return { status: 201, body: { code: 201, name: path } }
}

function listDirectory(e: EmployeeRecord, directory: string): Reply {
  const prefix = directory === '' ? '' : `${directory}/`
  const items = [...e.attachments.entries()]
    .filter(([name]) => name.startsWith(prefix))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, file]) => ({ code: 200, name, last_modified: file.uploadedAt.toISOString(), size: file.bytes.length }))
  return items.length === 0 ? error(404, `Directory "${directory}" not found`) : { status: 200, body: items }
}

function attachments(tenant: Tenant, employeeId: string, rawPath: string, request: MockRequest): Reply | Promise<Reply> {
  const e = byId(tenant, employeeId)
  if (e === undefined) return employeeNotFound
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return error(400, 'Invalid file name')
  }

  if (request.method === 'POST') return uploadAttachment(e, path, request)
  if (request.method !== 'GET') return notFound
  if (path === '' || path.endsWith('/')) return listDirectory(e, path.replace(/\/$/, ''))
  const file = e.attachments.get(path)
  // The published spec answers a missing file with 400, not 404.
  if (file === undefined) return error(400, `File "${path}" not found`)
  return { status: 200, bytes: file.bytes, headers: { 'Content-Type': file.contentType } }
}

function route(tenant: Tenant, rawPath: string, request: MockRequest): Reply | Promise<Reply> {
  const { method, url, body } = request
  const attachment = /^\/employees\/([^/]+)\/attachments\/(.*)$/.exec(rawPath)
  if (attachment !== null) return attachments(tenant, attachment[1] ?? '', attachment[2] ?? '', request)

  const segments = rawPath.split('/').slice(1).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return ''
    }
  })
  const [head, a, b, ...rest] = segments

  if (head === 'profile' && a === 'employee' && b === undefined && method === 'GET') {
    return paginate(
      SEED.profileAttributes.map(({ tag, description }) => ({ tag, description })),
      url,
    )
  }
  if (head === 'skills' && a === undefined && method === 'GET') return paginate(SEED.skills.map(skillItem), url)
  if (head === 'employee_skills' && a === undefined && method === 'POST') return createEmployeeSkill(tenant, body)
  if (head === 'employee_skills' && a !== undefined && b === undefined && method === 'GET') {
    return employeeSkill(tenant, a)
  }
  if (head !== undefined && /^\d+$/.test(head) && a === 'skills' && b === undefined && method === 'GET') {
    const e = byId(tenant, head)
    return e === undefined ? employeeNotFound : employeeSkillsView(tenant, e, url)
  }
  if (head !== 'employees') return notFound

  if (a === undefined) {
    if (method === 'GET') return listEmployees(tenant, url)
    if (method === 'POST') return createEmployee(tenant, body)
    return notFound
  }

  const e = a === 'by_id' ? byExternalId(tenant, b) : byId(tenant, a)
  const trailing = a === 'by_id' ? rest.length > 0 : b !== undefined
  if (trailing || (method !== 'GET' && method !== 'PUT')) return notFound
  if (e === undefined) return employeeNotFound
  return method === 'GET' ? employeeDetail(tenant, e) : updateEmployee(tenant, e, body)
}

// The public key names the tenant; the private key is not checked.
function publicKey(authorization: string | undefined): string | null {
  const encoded = /^Basic (.+)$/i.exec(authorization ?? '')?.[1]
  if (encoded === undefined) return null
  const credentials = Buffer.from(encoded, 'base64').toString('utf8')
  const colon = credentials.indexOf(':')
  return colon > 0 ? credentials.slice(0, colon) : null
}

// Not in the published docs; the adapter's retry path is exercised against these.
function fault(n: number, faults: FaultSchedule): Reply | null {
  if (faults.rateLimitEvery !== null && n % faults.rateLimitEvery === 0) {
    return { ...error(429, 'Too many requests'), headers: { 'Retry-After': '1' } }
  }
  if (faults.unavailableEvery !== null && n % faults.unavailableEvery === 0) {
    return error(503, 'Service unavailable')
  }
  return null
}

function send(res: ServerResponse, reply: Reply): void {
  if (reply.bytes !== undefined) {
    res.writeHead(reply.status, reply.headers).end(reply.bytes)
    return
  }
  res
    .writeHead(reply.status, { ...reply.headers, 'Content-Type': 'application/json' })
    .end(JSON.stringify(reply.body))
}

/** port 0 = ephemeral (tests). State is in memory and dies with the process. */
export function startAlayaCareMockServer(options: {
  readonly port: number
  readonly faults: FaultSchedule
}): Promise<RunningAlayaCareMock> {
  const tenants = new Map<string, Tenant>()
  let requests = 0

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await buffer(req)
    requests += 1
    const faulted = fault(requests, options.faults)
    if (faulted !== null) return send(res, faulted)

    const key = publicKey(req.headers.authorization)
    if (key === null) return send(res, error(401, 'Authorization required.'))
    const tenant = tenants.get(key) ?? seededTenant()
    tenants.set(key, tenant)

    // The raw path, not URL.pathname: URL parsing would collapse `.` and `..` in attachment paths.
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/'
    if (!rawPath.startsWith(`${BASE_PATH}/`)) return send(res, notFound)
    const request: MockRequest = {
      method: req.method ?? 'GET',
      url: new URL(req.url ?? '/', 'http://alayacare.mock'),
      headers: req.headers,
      body,
    }
    send(res, await route(tenant, rawPath.slice(BASE_PATH.length), request))
  }

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  return new Promise((resolve) => {
    server.listen(options.port, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            server.closeAllConnections()
          }),
      })
    })
  })
}
