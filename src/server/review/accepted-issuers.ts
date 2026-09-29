import 'server-only'
import { z } from 'zod'
import * as repository from '@/db/repositories/accepted-issuers'
import type {
  AcceptedIssuer,
  AcceptedIssuerInput,
  AcceptedIssuerWriteResult,
} from '@/domain/documents/accepted-issuer'
import { acceptedIssuerInputSchema } from '@/domain/documents/accepted-issuer'
import type { UseCase } from '@/server/auth/policy'
import { defineUseCase } from '@/server/auth/policy'

// The agency is always the principal's, never the input's: can() is not an agency check (T-014),
// so an id from another agency must come back NOT_FOUND. Inputs are parsed again because they
// arrive from a form and the type parameter is not a runtime check.
const idSchema = z.strictObject({ id: z.string().min(1) })
const updateInputSchema = acceptedIssuerInputSchema.extend(idSchema.shape)

export const listAcceptedIssuers: UseCase<Record<string, never>, readonly AcceptedIssuer[]> =
  defineUseCase('issuerAllowlist.manage', async ({ principal }) =>
    repository.findLiveAcceptedIssuers(principal.agencyId),
  )

export const addAcceptedIssuer: UseCase<AcceptedIssuerInput, AcceptedIssuerWriteResult> =
  defineUseCase('issuerAllowlist.manage', async ({ principal, input }) =>
    repository.createAcceptedIssuer(principal.agencyId, acceptedIssuerInputSchema.parse(input)),
  )

export const updateAcceptedIssuer: UseCase<
  { readonly id: string } & AcceptedIssuerInput,
  AcceptedIssuerWriteResult
> = defineUseCase('issuerAllowlist.manage', async ({ principal, input }) => {
  const { id, ...fields } = updateInputSchema.parse(input)
  return repository.updateAcceptedIssuer(principal.agencyId, id, fields)
})

export const retireAcceptedIssuer: UseCase<{ readonly id: string }, AcceptedIssuerWriteResult> =
  defineUseCase('issuerAllowlist.manage', async ({ principal, input }) =>
    repository.retireAcceptedIssuer(principal.agencyId, idSchema.parse(input).id, new Date()),
  )
