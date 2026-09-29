import { z } from 'zod'
import { auditEntryInputSchema } from '@/domain/audit/audit-entry'

// The four field-level-encrypted values (PRD § Security). The app, server and db layers share
// this list because src/app may not import ENCRYPTED_COLUMNS from src/db.
export const SENSITIVE_FIELDS = [
  'ssn',
  'bankAccountNumber',
  'bankRoutingNumber',
  'workAuthorizationNumber',
] as const

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number]

/**
 * What the ordinary (sealed) read gives a screen to render the mask from. Only SSN and bank
 * account have a plaintext `*Last4` column, so passing a last-4 for the other two is a compile
 * error rather than a silently ignored argument.
 */
export type SensitiveFieldDisplay =
  | { readonly field: 'ssn' | 'bankAccountNumber'; readonly last4: string | null }
  | { readonly field: 'bankRoutingNumber' | 'workAuthorizationNumber' }

/**
 * `null` means "never collected": render "Not provided" and offer no reveal. The routing and
 * work-authorisation masks are fixed-length and always shown, because the sealed read cannot
 * tell whether either was collected and a length that followed the value would leak it.
 */
export function maskSensitiveField(display: SensitiveFieldDisplay): string | null {
  switch (display.field) {
    case 'ssn':
      return display.last4 === null ? null : `•••-••-${display.last4}`
    case 'bankAccountNumber':
      return display.last4 === null ? null : `••••${display.last4}`
    case 'bankRoutingNumber':
      return '•••••••••'
    case 'workAuthorizationNumber':
      return '••••••••'
  }
}

export const revealSensitiveFieldInputSchema = z.strictObject({
  caregiverId: z.string().min(1),
  field: z.enum(SENSITIVE_FIELDS),
  // The same constraint policy.ts denies on and the audit log stores (CONVENTIONS.md § Code).
  reason: auditEntryInputSchema.shape.reason.unwrap(),
})

export type RevealSensitiveFieldInput = z.infer<typeof revealSensitiveFieldInputSchema>

// Declared here, not in src/db, because the app types the action's result and may not import
// src/db even for a type.
export type SensitiveFieldReveal =
  | { readonly status: 'revealed'; readonly value: string }
  | { readonly status: 'absent' }
