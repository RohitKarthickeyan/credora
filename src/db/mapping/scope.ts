/**
 * The scoped form of the two compound keys nobody remembers the spelling of. T-010 already made
 * cross-tenant *writes* impossible in Postgres through eleven composite foreign keys; this makes
 * the scoped read the shortest thing to write.
 *
 * A 1:N child (`EmploymentEntry`, `EducationEntry`, `Reference`, `EmergencyContact`,
 * `Credential`, `SignedDocument`, `CareSettingExperience`) has no `[agencyId, caregiverId]`
 * unique key and is read with `findMany({ where: { agencyId, caregiverId } })`, or one row with
 * `findFirst({ where: { agencyId, id } })` — plain object literals a helper would only obscure.
 * `CareSettingExperience`'s key is `agencyId_caregiverId_setting`, three columns, so
 * `satelliteKey` does not apply to it.
 *
 * What this cannot fix: `findUnique({ where: { id } })` is still expressible on all fourteen
 * models and returns a row regardless of tenant. Closing that needs Postgres row-level security
 * or a Prisma client extension, both ADR-sized (T-010 REVIEW § Follow-ups).
 */

/**
 * Tenant-scoped unique key for a 1:1 satellite — `IdentityRecord`, `ContactRecord`,
 * `HomeCareProfile`, `PayrollInputs`.
 */
export function satelliteKey(
  agencyId: string,
  caregiverId: string,
): { agencyId_caregiverId: { agencyId: string; caregiverId: string } } {
  return { agencyId_caregiverId: { agencyId, caregiverId } }
}
