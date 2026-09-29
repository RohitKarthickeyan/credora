import { US_STATE_CODES } from '@/domain/validation/address'

// Mirrors the Prisma enum CertificationLevel; keep the two in step.
export const CERTIFICATION_LEVELS = ['PCA', 'HHA', 'CNA'] as const

// The stored codes T-061 maps to form boxes; labels live in the section definitions.
export const SEX_MARKERS = ['F', 'M', 'X'] as const
export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'SEPARATED', 'WIDOWED'] as const
// NCIC codes, as CHRC-102 prints them.
export const EYE_COLORS = ['BLK', 'BLU', 'BRO', 'GRN', 'GRY', 'HAZ', 'MAR', 'MUL', 'PNK'] as const
export const HAIR_COLORS = ['BAL', 'BLK', 'BLN', 'BRO', 'GRY', 'RED', 'SDY', 'WHI'] as const
// One code for both the I-9 §1 attestation and which number is held (ADR-067).
export const WORK_AUTHORIZATION_TYPES = [
  'US_CITIZEN',
  'NONCITIZEN_NATIONAL',
  'PERMANENT_RESIDENT',
  'AUTHORIZED_ALIEN_USCIS_NUMBER',
  'AUTHORIZED_ALIEN_I94_NUMBER',
] as const
export const W4_FILING_STATUSES = ['SINGLE', 'MARRIED_FILING_JOINTLY', 'HEAD_OF_HOUSEHOLD'] as const
export const IT2104_FILING_STATUSES = [
  'SINGLE_OR_HEAD_OF_HOUSEHOLD',
  'MARRIED',
  'MARRIED_WITHHOLD_AT_SINGLE_RATE',
] as const
export const BANK_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS'] as const

export type ValueType =
  | 'text'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'textList'
  | 'address'
  | 'ssn'
  | 'money'
  | 'accountNumber'
  | 'routingNumber'
  | 'documentNumber'
export type RecordName = 'identity' | 'contact' | 'homeCareProfile' | 'payrollInputs'

type RecordFieldSpec = {
  readonly record: RecordName
  readonly type: ValueType
  readonly values?: readonly string[]
}
type CollectionFieldSpec = { readonly type: ValueType; readonly notNull?: true }

// Not bindable, on purpose: agency-set pay rates, directDepositAuthorizedAt (set by signing), and
// the restricted medical/eeoc stores. T-047 PLAN § Design 1 names each owner. email is listed so
// sync and documents can read it, but no intake section captures it: it is the sign-in key and
// only staff change it.
export const RECORD_FIELDS = {
  legalFirstName: { record: 'identity', type: 'text' },
  legalMiddleName: { record: 'identity', type: 'text' },
  legalLastName: { record: 'identity', type: 'text' },
  nameSuffix: { record: 'identity', type: 'text' },
  otherNames: { record: 'identity', type: 'textList' },
  sex: { record: 'identity', type: 'text', values: SEX_MARKERS },
  maritalStatus: { record: 'identity', type: 'text', values: MARITAL_STATUSES },
  countryOfBirth: { record: 'identity', type: 'text' },
  eyeColor: { record: 'identity', type: 'text', values: EYE_COLORS },
  hairColor: { record: 'identity', type: 'text', values: HAIR_COLORS },
  hasDriversLicense: { record: 'identity', type: 'boolean' },
  driversLicenseNumber: { record: 'identity', type: 'text' },
  driversLicenseState: { record: 'identity', type: 'text', values: US_STATE_CODES },
  workAuthorizationType: { record: 'identity', type: 'text', values: WORK_AUTHORIZATION_TYPES },
  workAuthorizationNumber: { record: 'identity', type: 'documentNumber' },
  heightInches: { record: 'identity', type: 'integer' },
  weightPounds: { record: 'identity', type: 'integer' },
  dateOfBirth: { record: 'identity', type: 'date' },
  driversLicenseExpiresAt: { record: 'identity', type: 'date' },
  workAuthorizationExpiresAt: { record: 'identity', type: 'date' },
  ssn: { record: 'identity', type: 'ssn' },

  address: { record: 'contact', type: 'address' },
  mobilePhone: { record: 'contact', type: 'text' },
  alternatePhone: { record: 'contact', type: 'text' },
  email: { record: 'contact', type: 'text' },
  preferredLanguage: { record: 'contact', type: 'text' },

  certificationsHeld: { record: 'homeCareProfile', type: 'textList', values: CERTIFICATION_LEVELS },
  clinicalSkills: { record: 'homeCareProfile', type: 'textList' },
  shiftTypes: { record: 'homeCareProfile', type: 'textList' },
  serviceAreas: { record: 'homeCareProfile', type: 'textList' },
  languages: { record: 'homeCareProfile', type: 'textList' },
  worksWithPets: { record: 'homeCareProfile', type: 'boolean' },
  worksWithSmokers: { record: 'homeCareProfile', type: 'boolean' },
  hasVehicle: { record: 'homeCareProfile', type: 'boolean' },
  covidVaccinationStatus: { record: 'homeCareProfile', type: 'text' },
  hepatitisBChoice: { record: 'homeCareProfile', type: 'text' },
  fluVaccinationChoice: { record: 'homeCareProfile', type: 'text' },
  fluDeclinationReason: { record: 'homeCareProfile', type: 'text' },

  w4FilingStatus: { record: 'payrollInputs', type: 'text', values: W4_FILING_STATUSES },
  it2104FilingStatus: { record: 'payrollInputs', type: 'text', values: IT2104_FILING_STATUSES },
  bankName: { record: 'payrollInputs', type: 'text' },
  bankAccountType: { record: 'payrollInputs', type: 'text', values: BANK_ACCOUNT_TYPES },
  w4MultipleJobs: { record: 'payrollInputs', type: 'boolean' },
  it2104ResidentNyc: { record: 'payrollInputs', type: 'boolean' },
  it2104ResidentYonkers: { record: 'payrollInputs', type: 'boolean' },
  it2104AllowancesNy: { record: 'payrollInputs', type: 'integer' },
  it2104AllowancesNyc: { record: 'payrollInputs', type: 'integer' },
  it2104AllowancesYonkers: { record: 'payrollInputs', type: 'integer' },
  w4DependentsAmountCents: { record: 'payrollInputs', type: 'money' },
  w4OtherIncomeCents: { record: 'payrollInputs', type: 'money' },
  w4DeductionsCents: { record: 'payrollInputs', type: 'money' },
  w4ExtraWithholdingCents: { record: 'payrollInputs', type: 'money' },
  it2104ExtraWithholdingNyCents: { record: 'payrollInputs', type: 'money' },
  bankRoutingNumber: { record: 'payrollInputs', type: 'routingNumber' },
  bankAccountNumber: { record: 'payrollInputs', type: 'accountNumber' },
} as const satisfies Readonly<Record<string, RecordFieldSpec>>

export type RecordFieldName = keyof typeof RECORD_FIELDS

// The one notNull text field per collection is its anchor: the column that is the reason the
// row exists, so an entry without it is never created.
export const COLLECTIONS = {
  employment: {
    fields: {
      employerName: { type: 'text', notNull: true },
      positionTitle: { type: 'text' },
      supervisorName: { type: 'text' },
      supervisorPhone: { type: 'text' },
      reasonForLeaving: { type: 'text' },
      address: { type: 'address' },
      startedOn: { type: 'date' },
      endedOn: { type: 'date' },
      isCurrent: { type: 'boolean', notNull: true },
      mayContact: { type: 'boolean', notNull: true },
    },
  },
  education: {
    fields: {
      schoolName: { type: 'text', notNull: true },
      city: { type: 'text' },
      state: { type: 'text' },
      programOrDegree: { type: 'text' },
      completedOn: { type: 'date' },
      graduated: { type: 'boolean' },
    },
  },
  references: {
    fields: {
      fullName: { type: 'text', notNull: true },
      relationship: { type: 'text' },
      employerName: { type: 'text' },
      phone: { type: 'text' },
      email: { type: 'text' },
    },
  },
  emergencyContacts: {
    fields: {
      fullName: { type: 'text', notNull: true },
      relationship: { type: 'text' },
      phone: { type: 'text' },
      alternatePhone: { type: 'text' },
      email: { type: 'text' },
    },
  },
  // At most one row per setting (the DB's @@unique), so a row's identity is its setting.
  careSettingExperience: {
    keyedByAnchor: true,
    fields: {
      setting: { type: 'text', notNull: true },
      years: { type: 'integer' },
    },
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly keyedByAnchor?: true
      readonly fields: Readonly<Record<string, CollectionFieldSpec>>
    }
  >
>

export type CollectionName = keyof typeof COLLECTIONS
