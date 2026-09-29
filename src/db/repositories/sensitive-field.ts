import { runInAuditedTransaction, writeAuditEntry } from '@/db/audit'
import { decryptField } from '@/db/crypto'
import { satelliteKey } from '@/db/mapping/scope'
import type { EncryptedColumn } from '@/db/mapping/sensitive'
import type {
  RevealSensitiveFieldInput,
  SensitiveField,
  SensitiveFieldReveal,
} from '@/domain/masking/sensitive-field'

// The audit fieldName is the envelope column read: "a column name, never a value".
const ENVELOPE_COLUMN = {
  ssn: 'ssnEnc',
  bankAccountNumber: 'bankAccountNumberEnc',
  bankRoutingNumber: 'bankRoutingNumberEnc',
  workAuthorizationNumber: 'workAuthorizationNumberEnc',
} as const satisfies Record<SensitiveField, EncryptedColumn>

/**
 * The one read-path decrypt (SECURITY.md § Field masking; ADR-022). Selects exactly one
 * envelope column, writes the audit entry and opens the envelope inside one transaction, so
 * plaintext cannot leave here unless its audit row commits. The entry is written on every
 * attempt, and a caregiver of another agency reads as `absent`, indistinguishable from a
 * value never collected. A decrypt failure rolls the entry back with it (ADR-015).
 */
export function readSensitiveField(
  agencyId: string,
  input: RevealSensitiveFieldInput,
): Promise<SensitiveFieldReveal> {
  return runInAuditedTransaction(async (tx) => {
    const where = satelliteKey(agencyId, input.caregiverId)
    let envelope: Uint8Array | null

    switch (input.field) {
      case 'ssn': {
        const row = await tx.identityRecord.findUnique({ where, select: { ssnEnc: true } })
        envelope = row?.ssnEnc ?? null
        break
      }
      case 'workAuthorizationNumber': {
        const row = await tx.identityRecord.findUnique({
          where,
          select: { workAuthorizationNumberEnc: true },
        })
        envelope = row?.workAuthorizationNumberEnc ?? null
        break
      }
      case 'bankAccountNumber': {
        const row = await tx.payrollInputs.findUnique({
          where,
          select: { bankAccountNumberEnc: true },
        })
        envelope = row?.bankAccountNumberEnc ?? null
        break
      }
      case 'bankRoutingNumber': {
        const row = await tx.payrollInputs.findUnique({
          where,
          select: { bankRoutingNumberEnc: true },
        })
        envelope = row?.bankRoutingNumberEnc ?? null
        break
      }
      default: {
        const unhandled: never = input.field
        throw new Error(`Unhandled sensitive field: ${String(unhandled)}`)
      }
    }

    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'CAREGIVER',
      entityId: input.caregiverId,
      fieldName: ENVELOPE_COLUMN[input.field],
      reason: input.reason,
    })

    const value = decryptField(envelope)
    return value === null ? { status: 'absent' } : { status: 'revealed', value }
  })
}
