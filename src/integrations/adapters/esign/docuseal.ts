import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import { createEnvelopeInputSchema } from '@/integrations/ports/esign'
import type { CreateEnvelopeInput, EnvelopeStatus, EsignEnvelope, EsignEvent, EsignPort } from '@/integrations/ports/esign'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import type { StoragePort } from '@/integrations/ports/storage'
import type { WebhookDelivery, WebhookVerification } from '@/integrations/ports/webhook'
import { env } from '@/lib/env'

// Self-hosted DocuSeal, checked against docuseal.com/docs/api and the open-source code, which
// differ from the plan in four places:
// - `POST /api/templates/pdf` is a Pro feature; the open-source image answers 404. The PDFs are
//   uploaded through the web app's own `POST /templates_upload` under an admin session (the only
//   way the free edition takes PDF bytes), then given a role and fields by `PUT /api/templates`.
// - `GET /api/submissions` has no `external_id` filter, but submitters carry one, so retry safety
//   is `GET /api/submitters?external_id=`. A crash between upload and submission leaves an unused
//   template behind, which nobody can sign.
// - One DocuSeal account serves every agency, so the agency, caregiver and our document refs ride
//   in the submitter's metadata, and a submission of another agency reads as unknown.
// - The webhook secret is a custom header set in DocuSeal's webhook settings. Subscribe to
//   form.completed and form.declined only: any other event is refused, and DocuSeal redelivers it.
const ROLE = 'Caregiver'
const SECRET_HEADER = 'x-credora-webhook-secret'
// Fractions of the page: bottom right of each document's last page.
const SIGNATURE_AREA = { x: 0.55, y: 0.86, w: 0.35, h: 0.06 }

const WEBHOOK_STATUS: Readonly<Record<string, EnvelopeStatus>> = {
  'form.completed': 'signed',
  'form.declined': 'declined',
}

const submitterSchema = z.object({ submission_id: z.number(), slug: z.string().min(1) })
type Submitter = z.infer<typeof submitterSchema>

const submissionSchema = z.object({
  status: z.enum(['pending', 'completed', 'declined', 'expired']),
  archived_at: z.string().nullable(),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  documents: z.array(z.object({ url: z.url() })),
  submitters: z.tuple([
    submitterSchema.extend({
      metadata: z.object({
        agencyId: z.uuid(),
        caregiverId: z.uuid(),
        documentRefs: z.array(z.string().min(1)).min(1),
      }),
    }),
  ]),
})
type Submission = z.infer<typeof submissionSchema>

const templateSchema = z.object({
  schema: z.array(z.object({ attachment_uuid: z.string().min(1) })),
  submitters: z.tuple([z.object({ uuid: z.string().min(1) })]),
})

const webhookBodySchema = z.object({
  event_type: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.object({ submission: z.object({ id: z.number() }) }),
})

function statusOf(submission: Submission): EnvelopeStatus {
  if (submission.status === 'completed') return 'signed'
  if (submission.archived_at !== null || submission.status === 'expired') return 'voided'
  return submission.status === 'declined' ? 'declined' : 'sent'
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

// Rails rewrites its session cookie on most responses, so each one's Set-Cookie is kept.
function cookieJar(): { keep(response: Response): Response; header(): string } {
  const cookies = new Map<string, string>()
  return {
    keep(response) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';')
        const split = pair.indexOf('=')
        cookies.set(pair.slice(0, split), pair.slice(split + 1))
      }
      return response
    },
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  }
}

function tokenIn(html: string, pattern: RegExp): string {
  const token = pattern.exec(html)?.[1]
  if (token === undefined) throw new Error('DocuSeal served a page without its CSRF token.')
  return token
}

function config() {
  const {
    DOCUSEAL_URL,
    DOCUSEAL_API_KEY,
    DOCUSEAL_WEBHOOK_SECRET,
    DOCUSEAL_ADMIN_EMAIL,
    DOCUSEAL_ADMIN_PASSWORD,
  } = env
  if (
    DOCUSEAL_URL === undefined ||
    DOCUSEAL_API_KEY === undefined ||
    DOCUSEAL_WEBHOOK_SECRET === undefined ||
    DOCUSEAL_ADMIN_EMAIL === undefined ||
    DOCUSEAL_ADMIN_PASSWORD === undefined
  ) {
    throw new Error(
      'ESIGN_ADAPTER=docuseal needs DOCUSEAL_URL, DOCUSEAL_API_KEY, DOCUSEAL_WEBHOOK_SECRET, ' +
        'DOCUSEAL_ADMIN_EMAIL and DOCUSEAL_ADMIN_PASSWORD to be set.',
    )
  }
  return {
    origin: DOCUSEAL_URL.replace(/\/$/, ''),
    apiKey: DOCUSEAL_API_KEY,
    webhookSecret: sha256(DOCUSEAL_WEBHOOK_SECRET),
    adminEmail: DOCUSEAL_ADMIN_EMAIL,
    adminPassword: DOCUSEAL_ADMIN_PASSWORD,
  }
}

export function createDocusealEsign(deps: { storage: StoragePort }): EsignPort {
  const { storage } = deps
  const { origin, apiKey, webhookSecret, adminEmail, adminPassword } = config()

  async function send(target: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    let response: Response
    try {
      response = await fetch(new URL(target, origin), {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      throw new VendorUnavailableError('esign', `DocuSeal did not answer ${method} ${target}: ${String(error)}`)
    }
    if (response.status === 429 || response.status >= 500) {
      throw new VendorUnavailableError('esign', `DocuSeal answered ${response.status} to ${method} ${target}`)
    }
    return response
  }

  // The parsed body, or null on 404.
  async function api(method: string, path: string, body?: object): Promise<unknown> {
    const response = await send(`/api${path}`, {
      method,
      headers: { 'X-Auth-Token': apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`DocuSeal answered ${response.status} to ${method} /api${path}: ${await response.text()}`)
    }
    return response.json()
  }

  async function uploadTemplate(files: readonly { name: string; bytes: Uint8Array }[]): Promise<number> {
    const jar = cookieJar()
    const signInPage = jar.keep(await send('/sign_in'))
    const signedIn = jar.keep(
      await send('/sign_in', {
        method: 'POST',
        headers: { Cookie: jar.header() },
        body: new URLSearchParams({
          authenticity_token: tokenIn(await signInPage.text(), /name="authenticity_token" value="([^"]+)"/),
          'user[email]': adminEmail,
          'user[password]': adminPassword,
        }),
      }),
    )
    if (signedIn.status !== 303) {
      throw new Error(`DocuSeal refused the admin sign-in (${signedIn.status}); check DOCUSEAL_ADMIN_*.`)
    }

    const home = jar.keep(await send('/', { headers: { Cookie: jar.header() } }))
    const form = new FormData()
    for (const file of files) {
      form.append('files[]', new Blob([new Uint8Array(file.bytes)], { type: 'application/pdf' }), `${file.name}.pdf`)
    }
    form.append('folder_name', 'Credora')
    const uploaded = await send('/templates_upload', {
      method: 'POST',
      headers: {
        Cookie: jar.header(),
        'X-CSRF-Token': tokenIn(await home.text(), /name="csrf-token" content="([^"]+)"/),
      },
      body: form,
    })
    const id = /\/templates\/(\d+)\/edit$/.exec(uploaded.headers.get('location') ?? '')?.[1]
    if (id === undefined) throw new Error(`DocuSeal did not accept the template upload (${uploaded.status}).`)
    return Number(id)
  }

  function unsignedEnvelope(
    submitter: Submitter,
    documentRefs: readonly string[],
    status: EnvelopeStatus,
  ): EsignEnvelope {
    return {
      envelopeId: String(submitter.submission_id),
      status,
      signingUrl: status === 'sent' ? `${origin}/s/${submitter.slug}` : null,
      documents: documentRefs.map((documentRef) => ({ documentRef, signedPdfKey: null })),
      signedAt: null,
    }
  }

  async function findSubmission(agencyId: string, envelopeId: string): Promise<Submission | null> {
    z.uuid().parse(agencyId)
    if (!/^\d+$/.test(envelopeId)) return null
    const body = await api('GET', `/submissions/${envelopeId}`)
    if (body === null) return null
    const submission = submissionSchema.parse(body)
    return submission.submitters[0].metadata.agencyId === agencyId ? submission : null
  }

  async function download(fileUrl: string): Promise<Uint8Array> {
    const response = await send(fileUrl)
    if (!response.ok) throw new Error(`DocuSeal answered ${response.status} to a signed document download.`)
    return new Uint8Array(await response.arrayBuffer())
  }

  return {
    async createEnvelope(input: CreateEnvelopeInput): Promise<EsignEnvelope> {
      const { agencyId, caregiverId, documents, signers, idempotencyKey } = createEnvelopeInputSchema.parse(input)
      const [signer] = signers
      if (signers.length !== 1 || signer?.role !== 'caregiver') {
        throw new Error('The DocuSeal adapter sends to the caregiver alone (OPEN-QUESTIONS 121).')
      }
      const documentRefs = documents.map((document) => document.documentRef)

      const earlier = z
        .object({ data: z.array(submitterSchema) })
        .parse(await api('GET', `/submitters?${new URLSearchParams({ external_id: idempotencyKey })}`))
      const [existing] = earlier.data
      if (existing !== undefined) return unsignedEnvelope(existing, documentRefs, 'sent')

      const files: { name: string; bytes: Uint8Array; lastPage: number }[] = []
      for (const document of documents) {
        const stored = await storage.read(agencyId, document.unsignedPdfKey)
        if (stored === null) {
          throw new Error(`Unsigned PDF for document "${document.documentRef}" is missing from storage.`)
        }
        const pdf = await PDFDocument.load(stored.bytes, { updateMetadata: false })
        files.push({ name: document.name, bytes: stored.bytes, lastPage: pdf.getPageCount() - 1 })
      }

      const templateId = await uploadTemplate(files)
      const template = templateSchema.parse(await api('GET', `/templates/${templateId}`))
      const [role] = template.submitters
      const fields = files.map((file, index) => {
        const attachment = template.schema[index]
        if (attachment === undefined) {
          throw new Error(`DocuSeal template ${templateId} holds fewer documents than were uploaded.`)
        }
        return {
          uuid: randomUUID(),
          name: `Signature ${index + 1}`,
          type: 'signature',
          required: true,
          submitter_uuid: role.uuid,
          areas: [{ attachment_uuid: attachment.attachment_uuid, page: file.lastPage, ...SIGNATURE_AREA }],
        }
      })
      await api('PUT', `/templates/${templateId}`, {
        external_id: idempotencyKey,
        submitters: [{ name: ROLE, uuid: role.uuid }],
        fields,
      })

      const [submitter] = z.tuple([submitterSchema]).parse(
        await api('POST', '/submissions', {
          template_id: templateId,
          send_email: false,
          submitters: [
            {
              role: ROLE,
              name: signer.fullName,
              email: signer.email,
              external_id: idempotencyKey,
              metadata: { agencyId, caregiverId, documentRefs },
            },
          ],
        }),
      )
      return unsignedEnvelope(submitter, documentRefs, 'sent')
    },

    // Signed copies map back to our documents by order: DocuSeal returns them in upload order. A
    // redelivered completion writes a second copy of each, which nothing references.
    async getEnvelope(agencyId: string, envelopeId: string): Promise<EsignEnvelope | null> {
      const submission = await findSubmission(agencyId, envelopeId)
      if (submission === null) return null
      const [submitter] = submission.submitters
      const { caregiverId, documentRefs } = submitter.metadata
      const status = statusOf(submission)
      if (status !== 'signed') return unsignedEnvelope(submitter, documentRefs, status)

      const documents = []
      for (const [index, documentRef] of documentRefs.entries()) {
        const signed = submission.documents[index]
        const signedPdfKey =
          signed === undefined
            ? null
            : await storage.write(
                { agencyId, caregiverId, kind: 'signed', extension: 'pdf' },
                await download(signed.url),
              )
        documents.push({ documentRef, signedPdfKey })
      }
      return {
        envelopeId,
        status,
        signingUrl: null,
        documents,
        signedAt: submission.completed_at === null ? null : new Date(submission.completed_at).toISOString(),
      }
    },

    async voidEnvelope(agencyId: string, envelopeId: string, reason: string): Promise<void> {
      z.string().min(1).parse(reason)
      if ((await findSubmission(agencyId, envelopeId)) === null) {
        throw new Error(`Unknown envelope ${envelopeId}.`)
      }
      await api('DELETE', `/submissions/${envelopeId}`)
    },

    verifyWebhook(delivery: WebhookDelivery): WebhookVerification<EsignEvent> {
      const secret = delivery.headers[SECRET_HEADER]
      if (secret === undefined) return { valid: false, reason: `Missing ${SECRET_HEADER} header.` }
      if (!timingSafeEqual(sha256(secret), webhookSecret)) {
        return { valid: false, reason: 'Webhook secret does not match.' }
      }

      const parsed = webhookBodySchema.safeParse(JSON.parse(delivery.rawBody))
      if (!parsed.success) return { valid: false, reason: 'Body is not a DocuSeal form event.' }
      const status = WEBHOOK_STATUS[parsed.data.event_type]
      if (status === undefined) {
        return { valid: false, reason: `Unsubscribed DocuSeal event ${parsed.data.event_type}.` }
      }
      return {
        valid: true,
        event: {
          envelopeId: String(parsed.data.data.submission.id),
          status,
          occurredAt: new Date(parsed.data.timestamp).toISOString(),
        },
      }
    },
  }
}
