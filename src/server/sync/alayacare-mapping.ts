import 'server-only'
import { z } from 'zod'
import * as repository from '@/db/repositories/alayacare-mapping'
import type { AlayaCareMappingWriteResult } from '@/db/repositories/alayacare-mapping'
import type {
  AlayaCareMappingChange,
  StoredAlayaCareMapping,
} from '@/domain/sync/alayacare-mapping'
import { alayaCareMappingChangeSchema } from '@/domain/sync/alayacare-mapping'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's. The input is parsed again because it
// arrives from a form and the type parameter is not a runtime check.
const updateInputSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  change: alayaCareMappingChangeSchema,
})

export const loadAlayaCareMapping: UseCase<Record<string, never>, StoredAlayaCareMapping> =
  defineUseCase('alayaCareMapping.manage', async ({ principal }) =>
    repository.findAlayaCareMapping(principal.agencyId),
  )

export const updateAlayaCareMapping: UseCase<
  { readonly expectedVersion: number; readonly change: AlayaCareMappingChange },
  AlayaCareMappingWriteResult
> = defineUseCase('alayaCareMapping.manage', async ({ principal, input }) => {
  const { expectedVersion, change } = updateInputSchema.parse(input)
  return repository.changeAlayaCareMapping(principal.agencyId, expectedVersion, change)
})
