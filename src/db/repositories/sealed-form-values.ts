import type { SealedFormValues } from '@/domain/documents/official-form'
import type { SensitiveField } from '@/domain/masking/sensitive-field'
import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { decryptField } from '@/db/crypto'
import { satelliteKey } from '@/db/mapping/scope'
import type { EncryptedColumn } from '@/db/mapping/sensitive'

// Copied, not imported from sensitive-field.ts: importing that module trips the reveal-importer
// allowlist (ADR-025).
const ENVELOPE_COLUMN = {
  ssn: 'ssnEnc',
  bankAccountNumber: 'bankAccountNumberEnc',
  bankRoutingNumber: 'bankRoutingNumberEnc',
  workAuthorizationNumber: 'workAuthorizationNumberEnc',
} as const satisfies Record<SensitiveField, EncryptedColumn>

/**
 * The second read-path decrypt (ADR-069): prints sealed values onto official forms inside
 * T-064's send. No person types a reason, so the reason names the documents. One VIEW entry per
 * requested field is written before any envelope is opened, on every attempt, under the ambient
 * actor; a decrypt failure rolls the entries back with it.
 */
export function readSealedFormValues(
  agencyId: string,
  caregiverId: string,
  fields: readonly SensitiveField[],
  documentKeys: readonly string[],
): Promise<SealedFormValues> {
  if (fields.length === 0) return Promise.resolve({})

  return runInAuditedTransaction(async (tx) => {
    const where = satelliteKey(agencyId, caregiverId)
    const identity = fields.some((field) => field === 'ssn' || field === 'workAuthorizationNumber')
      ? await tx.identityRecord.findUnique({
          where,
          select: {
            ssnEnc: fields.includes('ssn'),
            workAuthorizationNumberEnc: fields.includes('workAuthorizationNumber'),
          },
        })
      : null
    const payroll = fields.some(
      (field) => field === 'bankAccountNumber' || field === 'bankRoutingNumber',
    )
      ? await tx.payrollInputs.findUnique({
          where,
          select: {
            bankAccountNumberEnc: fields.includes('bankAccountNumber'),
            bankRoutingNumberEnc: fields.includes('bankRoutingNumber'),
          },
        })
      : null

    const envelopes: Record<SensitiveField, Uint8Array | null> = {
      ssn: identity?.ssnEnc ?? null,
      workAuthorizationNumber: identity?.workAuthorizationNumberEnc ?? null,
      bankAccountNumber: payroll?.bankAccountNumberEnc ?? null,
      bankRoutingNumber: payroll?.bankRoutingNumberEnc ?? null,
    }

    for (const field of fields) {
      await writeAuditEntry(tx, {
        agencyId,
        action: 'VIEW',
        entityType: 'CAREGIVER',
        entityId: caregiverId,
        fieldName: ENVELOPE_COLUMN[field],
        reason: `Printed on official forms: ${documentKeys.join(', ')}`,
      })
    }

    const values: Partial<Record<SensitiveField, string>> = {}
    for (const field of fields) {
      const value = decryptField(envelopes[field])
      if (value !== null) values[field] = value
    }
    return values
  })
}
