import type {
  IdentityRecordModel,
  IdentityRecordSelectScalar,
} from '@/db/generated/models/IdentityRecord'
import type {
  PayrollInputsModel,
  PayrollInputsSelectScalar,
} from '@/db/generated/models/PayrollInputs'
import type { SealedSelect, WithoutEnvelopes } from './sensitive'

/**
 * Tier-awareness at the select layer is one rule: no exported select contains an `*Enc` column.
 * Restricted models are unreachable from here at all (ADR-002), Standard columns are always
 * selectable, and the rest of a Sensitive model — `ssnLast4`, `sex`, the bank name, the rates —
 * is masked in the UI rather than withheld from the query.
 *
 * Only two models carry an envelope, so there are two constants. The other twelve core models
 * would get a select that excludes nothing; do not complete the set.
 */

/** Every IdentityRecord column except the two envelopes. */
export const identityRecordSealedSelect = {
  id: true,
  agencyId: true,
  caregiverId: true,
  legalFirstName: true,
  legalMiddleName: true,
  legalLastName: true,
  nameSuffix: true,
  otherNames: true,
  dateOfBirth: true,
  ssnLast4: true,
  sex: true,
  maritalStatus: true,
  countryOfBirth: true,
  heightInches: true,
  weightPounds: true,
  eyeColor: true,
  hairColor: true,
  hasDriversLicense: true,
  driversLicenseNumber: true,
  driversLicenseState: true,
  driversLicenseExpiresAt: true,
  workAuthorizationType: true,
  workAuthorizationExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies SealedSelect<IdentityRecordSelectScalar>

export type IdentityRecordSealedRow = WithoutEnvelopes<
  Pick<IdentityRecordModel, keyof typeof identityRecordSealedSelect>
>

/** Every PayrollInputs column except the two envelopes. */
export const payrollInputsSealedSelect = {
  id: true,
  agencyId: true,
  caregiverId: true,
  hourlyRateCents: true,
  overtimeRateCents: true,
  payFrequency: true,
  w4FilingStatus: true,
  w4MultipleJobs: true,
  w4DependentsAmountCents: true,
  w4OtherIncomeCents: true,
  w4DeductionsCents: true,
  w4ExtraWithholdingCents: true,
  it2104FilingStatus: true,
  it2104AllowancesNy: true,
  it2104AllowancesNyc: true,
  it2104AllowancesYonkers: true,
  it2104ExtraWithholdingNyCents: true,
  it2104ResidentNyc: true,
  it2104ResidentYonkers: true,
  bankName: true,
  bankAccountType: true,
  bankAccountLast4: true,
  directDepositAuthorizedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies SealedSelect<PayrollInputsSelectScalar>

export type PayrollInputsSealedRow = WithoutEnvelopes<
  Pick<PayrollInputsModel, keyof typeof payrollInputsSealedSelect>
>
