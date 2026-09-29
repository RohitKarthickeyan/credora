import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { z } from 'zod'
import {
  createEnvelopeInputSchema,
  envelopeStatusSchema,
  esignEventSchema,
  esignSignerSchema,
} from '@/integrations/ports/esign'
import type {
  CreateEnvelopeInput,
  EnvelopeStatus,
  EsignEnvelope,
  EsignEvent,
  EsignPort,
  EsignSigner,
} from '@/integrations/ports/esign'
import { storageKeySchema } from '@/integrations/ports/storage'
import type { StoragePort } from '@/integrations/ports/storage'
import type { WebhookDelivery, WebhookVerification } from '@/integrations/ports/webhook'
import { env } from '@/lib/env'

export type MockSigningView = {
  readonly envelopeId: string
  readonly status: EnvelopeStatus
  readonly signers: readonly EsignSigner[]
  readonly documentNames: readonly string[]
}

export type MockSignResult =
  | { readonly signed: true; readonly envelope: EsignEnvelope; readonly delivery: WebhookDelivery }
  | { readonly signed: false; readonly reason: 'unknown-envelope' | 'not-signable' }

type MockEsign = EsignPort & {
  /** The signing page's read. Takes no agencyId: the page is the vendor's, reached by envelope id alone. */
  getSigningView(envelopeId: string): Promise<MockSigningView | null>
  /** The signer's click. `signedAt` is the vendor-reported time; the caller owns the clock. */
  signEnvelope(envelopeId: string, signedAt: string): Promise<MockSignResult>
}

// Not a credential: the mock verifies only its own deliveries, and T-064 re-reads the envelope
// rather than trusting an event body, so a forged event changes nothing.
const MOCK_SECRET = 'credora-mock-esign-webhook-secret'
const SIGNATURE_HEADER = 'x-credora-mock-signature'
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/
// The path-traversal defence: the signing page passes a URL segment straight in.
const ENVELOPE_ID_PATTERN = /^env_mock_[0-9a-f]{24}$/

const stateSchema = z.object({
  envelopeId: z.string().regex(ENVELOPE_ID_PATTERN),
  agencyId: z.uuid(),
  caregiverId: z.uuid(),
  documents: z
    .array(
      z.object({
        documentRef: z.string().min(1),
        name: z.string().min(1),
        unsignedPdfKey: storageKeySchema,
        signedPdfKey: storageKeySchema.nullable(),
      }),
    )
    .min(1),
  signers: z.array(esignSignerSchema).min(1),
  status: envelopeStatusSchema,
  signedAt: z.iso.datetime().nullable(),
})
type EnvelopeState = z.infer<typeof stateSchema>

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENOENT'
}

function sign(rawBody: string): Buffer {
  return createHmac('sha256', MOCK_SECRET).update(rawBody).digest()
}

function deliveryFor(event: EsignEvent): WebhookDelivery {
  const rawBody = JSON.stringify({
    envelopeId: event.envelopeId,
    status: event.status,
    occurredAt: event.occurredAt,
  })
  return { rawBody, headers: { [SIGNATURE_HEADER]: `sha256=${sign(rawBody).toString('hex')}` } }
}

export function createMockEsign(options: {
  storage: StoragePort
  stateDir?: string
  appUrl?: string
}): MockEsign {
  const { storage } = options
  const stateDir = options.stateDir ?? path.join(env.STORAGE_ROOT, '_mock-esign')
  const appUrl = options.appUrl ?? env.APP_URL

  function stateFile(envelopeId: string): string {
    return path.join(stateDir, `${envelopeId}.json`)
  }

  async function load(envelopeId: string): Promise<EnvelopeState | null> {
    if (!ENVELOPE_ID_PATTERN.test(envelopeId)) return null

    let text: string
    try {
      text = await readFile(stateFile(envelopeId), 'utf8')
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    return stateSchema.parse(JSON.parse(text))
  }

  async function save(state: EnvelopeState): Promise<void> {
    await mkdir(stateDir, { recursive: true })
    await writeFile(stateFile(state.envelopeId), JSON.stringify(state))
  }

  function view(state: EnvelopeState): EsignEnvelope {
    return {
      envelopeId: state.envelopeId,
      status: state.status,
      signingUrl:
        state.status === 'sent' ? new URL(`/dev/esign/${state.envelopeId}`, appUrl).toString() : null,
      documents: state.documents.map(({ documentRef, signedPdfKey }) => ({ documentRef, signedPdfKey })),
      signedAt: state.signedAt,
    }
  }

  async function loadForAgency(agencyId: string, envelopeId: string): Promise<EnvelopeState | null> {
    const state = await load(envelopeId)
    return state?.agencyId === agencyId ? state : null
  }

  async function readPdf(state: EnvelopeState, documentRef: string, key: string): Promise<Uint8Array> {
    const stored = await storage.read(state.agencyId, key)
    if (stored === null) {
      throw new Error(`Unsigned PDF for document "${documentRef}" is missing from storage.`)
    }
    return stored.bytes
  }

  async function stamp(state: EnvelopeState, bytes: Uint8Array, signedAt: string): Promise<Uint8Array> {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.getPage(pdf.getPageCount() - 1)
    const lines = [
      'MOCK E-SIGNATURE — NOT LEGALLY BINDING',
      ...state.signers.map((signer) => `${signer.fullName} (${signer.role})`),
      `Envelope ${state.envelopeId} · ${signedAt}`,
    ]
    lines.forEach((line, index) => {
      page.drawText(line, { x: 36, y: 12 + (lines.length - 1 - index) * 9, size: 7, font })
    })
    pdf.setSubject(`Mock e-signature, envelope ${state.envelopeId}`)
    return pdf.save()
  }

  return {
    async createEnvelope(input: CreateEnvelopeInput): Promise<EsignEnvelope> {
      const { agencyId, caregiverId, documents, signers, idempotencyKey } =
        createEnvelopeInputSchema.parse(input)
      const envelopeId =
        'env_mock_' +
        createHash('sha256').update(`${agencyId}:${idempotencyKey}`).digest('hex').slice(0, 24)

      const existing = await load(envelopeId)
      if (existing !== null) return view(existing)

      const state: EnvelopeState = {
        envelopeId,
        agencyId,
        caregiverId,
        documents: documents.map((document) => ({ ...document, signedPdfKey: null })),
        signers,
        status: 'sent',
        signedAt: null,
      }
      for (const document of state.documents) {
        await readPdf(state, document.documentRef, document.unsignedPdfKey)
      }
      await save(state)
      return view(state)
    },

    async getEnvelope(agencyId: string, envelopeId: string): Promise<EsignEnvelope | null> {
      const state = await loadForAgency(z.uuid().parse(agencyId), envelopeId)
      return state === null ? null : view(state)
    },

    async voidEnvelope(agencyId: string, envelopeId: string, reason: string): Promise<void> {
      z.string().min(1).parse(reason)
      const state = await loadForAgency(z.uuid().parse(agencyId), envelopeId)
      if (state === null) throw new Error(`Unknown envelope ${envelopeId}.`)
      if (state.status === 'signed') throw new Error(`Envelope ${envelopeId} is signed and cannot be voided.`)
      if (state.status === 'voided') return
      await save({ ...state, status: 'voided' })
    },

    verifyWebhook(delivery: WebhookDelivery): WebhookVerification<EsignEvent> {
      const header = delivery.headers[SIGNATURE_HEADER]
      if (header === undefined) return { valid: false, reason: `Missing ${SIGNATURE_HEADER} header.` }

      const match = SIGNATURE_PATTERN.exec(header)
      if (match?.[1] === undefined) {
        return { valid: false, reason: 'Signature is not sha256=<64 lower-case hex characters>.' }
      }
      if (!timingSafeEqual(Buffer.from(match[1], 'hex'), sign(delivery.rawBody))) {
        return { valid: false, reason: 'Signature does not match the body.' }
      }

      const parsed = esignEventSchema.safeParse(JSON.parse(delivery.rawBody))
      return parsed.success
        ? { valid: true, event: parsed.data }
        : { valid: false, reason: 'Body is not an e-sign event.' }
    },

    async getSigningView(envelopeId: string): Promise<MockSigningView | null> {
      const state = await load(envelopeId)
      if (state === null) return null
      return {
        envelopeId: state.envelopeId,
        status: state.status,
        signers: state.signers,
        documentNames: state.documents.map((document) => document.name),
      }
    },

    async signEnvelope(envelopeId: string, signedAt: string): Promise<MockSignResult> {
      const state = await load(envelopeId)
      if (state === null) return { signed: false, reason: 'unknown-envelope' }
      if (state.status !== 'sent') return { signed: false, reason: 'not-signable' }
      z.iso.datetime().parse(signedAt)

      const documents: EnvelopeState['documents'] = []
      for (const document of state.documents) {
        const bytes = await readPdf(state, document.documentRef, document.unsignedPdfKey)
        const signedPdfKey = await storage.write(
          { agencyId: state.agencyId, caregiverId: state.caregiverId, kind: 'signed', extension: 'pdf' },
          await stamp(state, bytes, signedAt),
        )
        documents.push({ ...document, signedPdfKey })
      }

      const signedState: EnvelopeState = { ...state, documents, status: 'signed', signedAt }
      await save(signedState)
      return {
        signed: true,
        envelope: view(signedState),
        delivery: deliveryFor({ envelopeId, status: 'signed', occurredAt: signedAt }),
      }
    },
  }
}
