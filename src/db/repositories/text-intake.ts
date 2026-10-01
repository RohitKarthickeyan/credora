import type { Address } from '@/domain/validation/address'
import { type AuditedTx, writeAuditEntry } from '../audit'
import { toAddressColumns } from '../mapping/address'
import { toDateColumn } from '../mapping/date-only'
import { satelliteKey } from '../mapping/scope'
import { toSsnColumns } from '../mapping/sensitive'

export type TextIntakeWrite =
  | { readonly field: 'legalName'; readonly value: { readonly first: string; readonly last: string } }
  | { readonly field: 'dateOfBirth'; readonly value: string }
  | { readonly field: 'sex'; readonly value: string }
  | { readonly field: 'ssn'; readonly value: string }
  | { readonly field: 'email'; readonly value: string }
  | { readonly field: 'address'; readonly value: Address }

function identityColumns(write: Exclude<TextIntakeWrite, { field: 'email' | 'address' }>) {
  switch (write.field) {
    case 'legalName':
      return { legalFirstName: write.value.first, legalLastName: write.value.last }
    case 'dateOfBirth':
      return { dateOfBirth: toDateColumn(write.value) }
    case 'ssn':
      return toSsnColumns(write.value)
    case 'sex':
      return { sex: write.value }
  }
}

/** One validated answer from a text, written to its identity or contact column. */
export async function writeTextIntakeField(
  tx: AuditedTx,
  agencyId: string,
  caregiverId: string,
  write: TextIntakeWrite,
): Promise<void> {
  const where = satelliteKey(agencyId, caregiverId)
  const scope = { agencyId, caregiverId }
  if (write.field === 'address' || write.field === 'email') {
    const data = write.field === 'address' ? toAddressColumns(write.value) : { email: write.value }
    await tx.contactRecord.upsert({ where, create: { ...data, ...scope }, update: data })
  } else {
    const data = identityColumns(write)
    await tx.identityRecord.upsert({ where, create: { ...data, ...scope }, update: data })
  }
  await writeAuditEntry(tx, {
    agencyId,
    action: 'EDIT',
    entityType: 'CAREGIVER',
    entityId: caregiverId,
    fieldName: write.field,
  })
}
