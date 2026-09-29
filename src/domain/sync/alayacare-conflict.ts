import { z } from 'zod'
import type { AlayaCareProfileFields } from './alayacare-sync'

export const ALAYACARE_PROFILE_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'email', 'phone', 'startDate'] as const
export type AlayaCareProfileField = (typeof ALAYACARE_PROFILE_FIELDS)[number]

// AlayaCare never changes a recorded birthday (ADR-049), so a DOB difference has no choice to
// make in Credora (OPEN-QUESTIONS 239). startDate is absent because we never hold one (OPEN-QUESTIONS 192).
export const RESOLVABLE_PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
export type ResolvableProfileField = (typeof RESOLVABLE_PROFILE_FIELDS)[number]

const PROFILE_CHOICES = ['OURS', 'THEIRS'] as const
type ProfileChoice = (typeof PROFILE_CHOICES)[number]
export const profileChoicesSchema = z.partialRecord(z.enum(RESOLVABLE_PROFILE_FIELDS), z.enum(PROFILE_CHOICES))
export type ProfileChoices = z.infer<typeof profileChoicesSchema>

/** What AlayaCare holds for a profile: the port's AlayaCareProfile minus externalId. */
export type AlayaCareProfileValues = {
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly email: string | null
  readonly phone: string | null
  readonly startDate: string | null
}

type ProfileReconciliation =
  | { readonly ok: true; readonly profile: AlayaCareProfileValues }
  | { readonly ok: false; readonly conflicts: readonly AlayaCareProfileField[] }

const CASE_INSENSITIVE: ReadonlySet<AlayaCareProfileField> = new Set(['firstName', 'lastName', 'email'])

function equivalent(field: AlayaCareProfileField, ours: string, theirs: string): boolean {
  if (!CASE_INSENSITIVE.has(field)) return ours === theirs
  return ours.trim().toLowerCase() === theirs.trim().toLowerCase()
}

function isResolvable(field: AlayaCareProfileField): field is ResolvableProfileField {
  return (RESOLVABLE_PROFILE_FIELDS as readonly string[]).includes(field)
}

function decide(
  field: AlayaCareProfileField,
  ours: string | null,
  theirs: string | null,
  choices: ProfileChoices,
): ProfileChoice | 'CONFLICT' {
  if (theirs === null) return 'OURS'
  if (ours === null) return 'THEIRS'
  if (equivalent(field, ours, theirs)) return 'THEIRS'
  if (!isResolvable(field)) return 'CONFLICT'
  return choices[field] ?? 'CONFLICT'
}

/** The profile to PUT over a known employee, or the fields that differ with no choice made. */
export function reconcileAlayaCareProfile(
  ours: AlayaCareProfileFields,
  theirs: AlayaCareProfileValues,
  choices: ProfileChoices,
): ProfileReconciliation {
  const conflicts = ALAYACARE_PROFILE_FIELDS.filter((field) => decide(field, ours[field], theirs[field], choices) === 'CONFLICT')
  if (conflicts.length > 0) return { ok: false, conflicts }

  const pick = <T extends string | null>(field: AlayaCareProfileField, our: T, their: T): T =>
    decide(field, our, their, choices) === 'OURS' ? our : their
  return {
    ok: true,
    profile: {
      firstName: pick('firstName', ours.firstName, theirs.firstName),
      lastName: pick('lastName', ours.lastName, theirs.lastName),
      dateOfBirth: pick('dateOfBirth', ours.dateOfBirth, theirs.dateOfBirth),
      email: pick('email', ours.email, theirs.email),
      phone: pick('phone', ours.phone, theirs.phone),
      startDate: pick('startDate', ours.startDate, theirs.startDate),
    },
  }
}

/** `field:CHOICE` for each chosen field, in RESOLVABLE_PROFILE_FIELDS order; [] when none, so a
 *  job without choices keeps ADR-117's profile key. */
export function profileChoiceParts(choices: ProfileChoices): readonly string[] {
  return RESOLVABLE_PROFILE_FIELDS.flatMap((field) => {
    const choice = choices[field]
    return choice === undefined ? [] : [`${field}:${choice}`]
  })
}
