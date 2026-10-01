import 'server-only'
import { z } from 'zod'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { readMessageSsn } from '@/db/mapping/message-ssn'
import { createAttestation } from '@/db/repositories/attestations'
import { findContactPreferences } from '@/db/repositories/contact-preferences'
import { isEmailInUse } from '@/db/repositories/invites'
import { applyPipelineTransition } from '@/db/repositories/pipeline-transitions'
import {
  changeRequirementInstanceStatus,
  findRequirementInstances,
  linkEvidence,
  requireStatusChanged,
} from '@/db/repositories/requirement-instances'
import { type TextIntakeWrite, writeTextIntakeField } from '@/db/repositories/text-intake'
import type { TextIntakeField } from '@/domain/conversation/step'
import { SEX_MARKERS } from '@/domain/forms/canonical-record'
import { intakeSubmittedEvidenceKey } from '@/domain/forms/intake-flow'
import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { addressSchema } from '@/domain/validation/address'
import { dateOfBirthSchema } from '@/domain/validation/date-of-birth'
import { emailSchema } from '@/domain/validation/email'
import { personNameSchema } from '@/domain/validation/name'
import { ssnSchema } from '@/domain/validation/ssn'
import type { StoragePort } from '@/integrations/ports/storage'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'
import { type SendDocumentSetResult, sendOwnDocumentSet } from '@/server/forms/signing'

type SaveTextIntakeFieldResult = { ok: true } | { ok: false; reason: 'INVALID' | 'EMAIL_IN_USE' }

const INVALID = { ok: false, reason: 'INVALID' } as const

function parseLegalName(value: unknown): { first: string; last: string } | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const split = trimmed.lastIndexOf(' ')
  if (split < 0) return null
  const parsed = personNameSchema.safeParse({ first: trimmed.slice(0, split), last: trimmed.slice(split + 1) })
  return parsed.success ? { first: parsed.data.first, last: parsed.data.last } : null
}

/**
 * One answer from a text, validated with the intake form's own schemas. The SSN is never passed
 * in: it is opened from the caregiver's message here and written straight to its column.
 */
export const saveTextIntakeField: UseCase<
  {
    readonly caregiverId: string
    readonly field: TextIntakeField | 'legalName'
    readonly value: unknown
    readonly ssnMessageId?: string
  },
  SaveTextIntakeFieldResult
> = defineUseCase('caregiver.editOwn', ({ principal, input }) =>
  runInAuditedTransaction(async (tx): Promise<SaveTextIntakeFieldResult> => {
    const { agencyId } = principal
    const { caregiverId, value } = input

    let write: TextIntakeWrite
    switch (input.field) {
      case 'legalName': {
        const name = parseLegalName(value)
        if (name === null) return INVALID
        write = { field: 'legalName', value: name }
        break
      }
      case 'dateOfBirth': {
        const parsed = dateOfBirthSchema(new Date()).safeParse(value)
        if (!parsed.success) return INVALID
        write = { field: 'dateOfBirth', value: parsed.data }
        break
      }
      case 'sex': {
        const parsed = z.enum(SEX_MARKERS).safeParse(value)
        if (!parsed.success) return INVALID
        write = { field: 'sex', value: parsed.data }
        break
      }
      case 'email': {
        const parsed = emailSchema.safeParse(value)
        if (!parsed.success) return INVALID
        const current = await findContactPreferences(tx, agencyId, caregiverId)
        if (current?.email !== parsed.data && (await isEmailInUse(tx, agencyId, parsed.data))) {
          return { ok: false, reason: 'EMAIL_IN_USE' }
        }
        write = { field: 'email', value: parsed.data }
        break
      }
      case 'address': {
        const parsed = addressSchema.safeParse(value)
        if (!parsed.success) return INVALID
        write = { field: 'address', value: parsed.data }
        break
      }
      case 'ssn': {
        if (input.ssnMessageId === undefined) return INVALID
        const ssn = await readMessageSsn(tx, agencyId, caregiverId, input.ssnMessageId)
        const parsed = ssnSchema.safeParse(ssn)
        if (!parsed.success) return INVALID
        write = { field: 'ssn', value: parsed.data }
        break
      }
    }

    await writeTextIntakeField(tx, agencyId, caregiverId, write)
    // Refusals are ignored, as in saveIntakeStep: only the first save moves INVITED to INTAKE.
    await applyPipelineTransition(tx, agencyId, { caregiverId, event: 'INTAKE_STARTED', actorUserId: null })
    return { ok: true }
  }),
)

/** The caregiver's YES to the read-back: the text intake is attested, then the forms are sent. */
export const confirmTextIntake: UseCase<
  { readonly caregiverId: string; readonly storage: StoragePort },
  SendDocumentSetResult
> = defineUseCase('caregiver.editOwn', async ({ principal, input }) => {
  const { agencyId } = principal
  const { caregiverId, storage } = input
  const key = INTAKE_REQUIREMENT_KEYS.TEXT

  const instances = await findRequirementInstances(agencyId, caregiverId)
  const instance = instances.find((candidate) => candidate.templateKey === key)
  if (instance === undefined) return { ok: false, reason: 'not-ready' }

  if (instance.status !== 'SATISFIED') {
    await runInAuditedTransaction(async (tx) => {
      if (instance.status === 'NOT_STARTED') {
        requireStatusChanged(await changeRequirementInstanceStatus(agencyId, instance.id, 'PENDING'), instance.id)
      }
      const attestation = await createAttestation(agencyId, caregiverId)
      const evidenceKey = intakeSubmittedEvidenceKey(key)
      const link = await linkEvidence(agencyId, instance.id, evidenceKey, {
        kind: 'ATTESTATION',
        attestationId: attestation.id,
      })
      if (!link.ok) {
        throw new Error(`Requirement instance ${instance.id} does not accept ATTESTATION ${evidenceKey}.`)
      }
      requireStatusChanged(await changeRequirementInstanceStatus(agencyId, instance.id, 'SATISFIED'), instance.id)
      await writeAuditEntry(tx, {
        agencyId,
        action: 'EDIT',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
        fieldName: 'attestations',
      })
    })
  }

  return sendOwnDocumentSet({ caregiverId, storage })
})
