import { z } from 'zod'
import { parseStorageKey, storageKeySchema } from './storage'
import type { WebhookDelivery, WebhookVerification } from './webhook'

// Port contract: permanent outcomes are returned and transient failures throw
// VendorUnavailableError; agencyId leads every input; no result carries a time read from the
// clock; every mutating call carries a caller-built idempotencyKey; adapters parse each input
// with its schema first.

export const envelopeStatusSchema = z.enum(['created', 'sent', 'signed', 'declined', 'voided'])
export type EnvelopeStatus = z.infer<typeof envelopeStatusSchema>

export const esignSignerSchema = z.object({
  role: z.enum(['caregiver', 'agencyRepresentative']),
  fullName: z.string().min(1),
  email: z.email(),
})
export type EsignSigner = z.infer<typeof esignSignerSchema>

export const envelopeDocumentSchema = z.object({
  documentRef: z.string().min(1),
  name: z.string().min(1),
  unsignedPdfKey: storageKeySchema,
})
export type EnvelopeDocument = z.infer<typeof envelopeDocumentSchema>

// The document list is the envelope (DOMAIN "Envelope"), and each PDF crosses as a storage key,
// never bytes (ADR-005): the adapter writes each signed copy through its own storage port.
export const createEnvelopeInputSchema = z
  .object({
    agencyId: z.uuid(),
    caregiverId: z.uuid(),
    documents: z.array(envelopeDocumentSchema).min(1),
    signers: z.array(esignSignerSchema).min(1),
    idempotencyKey: z.string().min(1),
  })
  .refine(
    (input) =>
      new Set(input.documents.map((document) => document.documentRef)).size ===
      input.documents.length,
    { error: 'Every documentRef in an envelope must be unique.', path: ['documents'] },
  )
  .refine(
    (input) =>
      input.documents.every((document) => {
        const parts = parseStorageKey(document.unsignedPdfKey)
        return parts?.agencyId === input.agencyId && parts.caregiverId === input.caregiverId
      }),
    {
      error: "Every unsignedPdfKey must belong to the envelope's own agency and caregiver.",
      path: ['documents'],
    },
  )
export type CreateEnvelopeInput = z.infer<typeof createEnvelopeInputSchema>

export const signedEnvelopeDocumentSchema = z.object({
  documentRef: z.string().min(1),
  signedPdfKey: storageKeySchema.nullable(),
})
export type SignedEnvelopeDocument = z.infer<typeof signedEnvelopeDocumentSchema>

export const esignEnvelopeSchema = z.object({
  envelopeId: z.string().min(1),
  status: envelopeStatusSchema,
  signingUrl: z.url().nullable(),
  documents: z.array(signedEnvelopeDocumentSchema).min(1),
  signedAt: z.iso.datetime().nullable(),
})
export type EsignEnvelope = z.infer<typeof esignEnvelopeSchema>

export const esignEventSchema = z.object({
  envelopeId: z.string().min(1),
  status: envelopeStatusSchema,
  occurredAt: z.iso.datetime(),
})
export type EsignEvent = z.infer<typeof esignEventSchema>

export interface EsignPort {
  createEnvelope(input: CreateEnvelopeInput): Promise<EsignEnvelope>
  getEnvelope(agencyId: string, envelopeId: string): Promise<EsignEnvelope | null>
  voidEnvelope(agencyId: string, envelopeId: string, reason: string): Promise<void>
  verifyWebhook(delivery: WebhookDelivery): WebhookVerification<EsignEvent>
}
