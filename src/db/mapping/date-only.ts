import { z } from 'zod'

/**
 * The ten `@db.Date` columns this module owns:
 *
 * | Model                    | Columns                                                              |
 * | ------------------------ | -------------------------------------------------------------------- |
 * | `IdentityRecord`         | `dateOfBirth`, `driversLicenseExpiresAt`, `workAuthorizationExpiresAt` |
 * | `EmploymentEntry`        | `startedOn`, `endedOn`                                                 |
 * | `EducationEntry`         | `completedOn`                                                          |
 * | `Credential`             | `issuedOn`, `expiresAt`                                                |
 * | `MedicalScreeningResult` | `resultedOn` (NOT NULL; reached only from `src/db/restricted/`)        |
 * | `RequirementInstance`    | `resultedOn` (a passing health screening result's date)              |
 *
 * `Credential.verifiedAt`, `PayrollInputs.directDepositAuthorizedAt`,
 * `SignedDocument.signedAt`, `AuditEntry.at` and every `createdAt`/`updatedAt` are instants with
 * no `@db.Date`. They are not this module's business and must not be routed through it.
 *
 * Both directions are UTC-only arithmetic: no local-time API appears in this file. `date-fns` is
 * deliberately unused here — `parseISO` returns local midnight and `format` renders local time,
 * which is the day-shift this module exists to prevent (CONVENTIONS.md § Code).
 *
 * A branded `DateOnly` string type was considered and rejected: Prisma types a `@db.Date` input
 * as `Date | string`, so a brand would add friction to T-004's output without closing anything.
 */

// Encodes month lengths and the full Gregorian leap rule, so no date-fns calendar check is needed.
const dateOnlySchema = z.iso.date()

/**
 * Convert a canonical `YYYY-MM-DD` value into the `Date` a `@db.Date` column takes.
 * `null` in, `null` out. Throws on anything that is not a real calendar date.
 */
export function toDateColumn(value: string): Date
export function toDateColumn(value: string | null): Date | null
export function toDateColumn(value: string | null): Date | null {
  if (value === null) return null

  const parsed = dateOnlySchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `A @db.Date column takes a YYYY-MM-DD calendar date; received ${JSON.stringify(value)}.`,
    )
  }

  return new Date(`${parsed.data}T00:00:00.000Z`)
}

/**
 * Convert a `@db.Date` column value back to `YYYY-MM-DD`. `null` in, `null` out.
 * Throws if the value carries a time component, which means the column is not date-only.
 */
export function fromDateColumn(value: Date): string
export function fromDateColumn(value: Date | null): string | null
export function fromDateColumn(value: Date | null): string | null {
  if (value === null) return null

  const carriesTime =
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0

  // Unreachable from a `date` column, which Postgres truncates. It catches a future column
  // declared `DateTime` without `@db.Date` being routed here by mistake.
  if (carriesTime) {
    throw new Error(
      `${value.toISOString()} carries a time component, so it did not come from a @db.Date ` +
        'column. Only the nine date-only columns belong in @/db/mapping/date-only; an instant ' +
        'stays a Date.',
    )
  }

  return value.toISOString().slice(0, 10)
}
