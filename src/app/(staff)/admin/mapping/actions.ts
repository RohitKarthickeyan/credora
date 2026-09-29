'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import type { Principal } from '@/domain/auth/role'
import {
  type AlayaCareMappingChange,
  CREDENTIAL_TYPES,
  alayaCareMappingChangeSchema,
} from '@/domain/sync/alayacare-mapping'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import { updateAlayaCareMapping } from '@/server/sync/alayacare-mapping'
import { parseSourceOption } from './source-options'

export type MappingFormState = {
  readonly error?: string
  readonly fieldErrors?: Readonly<Record<string, string | undefined>>
  readonly values?: Readonly<Record<string, string>>
}

type WriteResult = Awaited<ReturnType<typeof updateAlayaCareMapping>>

const REFUSALS: Record<Extract<WriteResult, { ok: false }>['reason'], string> = {
  STALE: 'Someone else changed this mapping. Reload the page to see their change.',
  DUPLICATE_KEY: 'That AlayaCare field is already mapped.',
  UNKNOWN_KEY: 'That AlayaCare field is no longer mapped.',
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function update(
  principal: Principal,
  expectedVersion: number,
  change: AlayaCareMappingChange,
): Promise<WriteResult> {
  return runAsPrincipal(principal, {}, () => updateAlayaCareMapping({ expectedVersion, change }))
}

// The first message per issue path below the change's top-level key, e.g. field.source → source.
function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    errors[issue.path.slice(1).join('.')] ??= issue.message
  }
  return errors
}

export async function saveCredentialCodes(
  expectedVersion: number,
  _previous: MappingFormState,
  formData: FormData,
): Promise<MappingFormState> {
  const { principal } = await requireStaffSession()
  const values = Object.fromEntries(
    CREDENTIAL_TYPES.map((type) => [`code.${type}`, text(formData, `code.${type}`)]),
  )
  const credentialCodes = Object.fromEntries(
    CREDENTIAL_TYPES.map((type) => [type, text(formData, `code.${type}`).trim()]).filter(
      ([, code]) => code !== '',
    ),
  )
  const parsed = alayaCareMappingChangeSchema.safeParse({
    kind: 'setCredentialCodes',
    credentialCodes,
  })
  if (!parsed.success) {
    const errors = fieldErrorsOf(parsed.error)
    return {
      fieldErrors: Object.fromEntries(
        Object.entries(errors).map(([type, message]) => [`code.${type}`, message]),
      ),
      values,
    }
  }

  const result = await update(principal, expectedVersion, parsed.data)
  if (!result.ok) return { error: REFUSALS[result.reason], values }

  revalidatePath('/admin/mapping')
  return {}
}

export async function addCustomField(
  expectedVersion: number,
  _previous: MappingFormState,
  formData: FormData,
): Promise<MappingFormState> {
  const { principal } = await requireStaffSession()
  const values = {
    alayaCareKey: text(formData, 'alayaCareKey'),
    alayaCareType: text(formData, 'alayaCareType'),
    source: text(formData, 'source'),
  }
  const source = parseSourceOption(values.source)
  if (source === null) return { fieldErrors: { source: 'Choose a source.' }, values }

  const parsed = alayaCareMappingChangeSchema.safeParse({
    kind: 'addCustomField',
    field: { alayaCareKey: values.alayaCareKey, alayaCareType: values.alayaCareType, source },
  })
  if (!parsed.success) {
    const errors = fieldErrorsOf(parsed.error)
    return {
      fieldErrors: {
        alayaCareKey: errors.alayaCareKey,
        alayaCareType: errors.alayaCareType,
        source: errors.source,
      },
      values,
    }
  }

  const result = await update(principal, expectedVersion, parsed.data)
  if (!result.ok) return { error: REFUSALS[result.reason], values }

  revalidatePath('/admin/mapping')
  return {}
}

export async function removeCustomField(
  expectedVersion: number,
  alayaCareKey: string,
): Promise<void> {
  const { principal } = await requireStaffSession()
  const result = await update(principal, expectedVersion, {
    kind: 'removeCustomField',
    alayaCareKey,
  })
  if (result.ok) revalidatePath('/admin/mapping')
}
