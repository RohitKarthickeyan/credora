import { RECORD_FIELDS } from '@/domain/forms/canonical-record'
import { SENSITIVE_FIELDS, type SensitiveField } from '@/domain/masking/sensitive-field'
import { DOCUMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { Address } from '@/domain/validation/address'
import { formatCents } from '@/domain/validation/money'
import { formatSsn } from '@/domain/validation/ssn'
import type { RenderedBlock, RenderedDocument } from './agency-document'
import type { DocumentSetEntry } from './document-set'
import {
  isWinAnsi,
  type OfficialFormField,
  type OfficialFormRecord,
  type OfficialFormRefusal,
  type SealedFormValues,
} from './official-form'

export type AcroFormFill = {
  readonly kind: 'acroform'
  readonly documentKey: string
  readonly templateVersion: string
  readonly title: string
  readonly asset: string
  readonly text: Readonly<Record<string, string>>
  readonly checks: Readonly<Record<string, string>>
  readonly dropdowns: Readonly<Record<string, string>>
}

type OfficialFormFill =
  | AcroFormFill
  | { readonly kind: 'composed'; readonly document: RenderedDocument }

type OfficialFormsFillResult =
  | { readonly ok: true; readonly fills: readonly OfficialFormFill[] }
  | { readonly ok: false; readonly refusals: readonly OfficialFormRefusal[] }

type Facts = OfficialFormRecord & { readonly [K in SensitiveField]: string | null }
type Fact = keyof Facts & OfficialFormField
type Needed<K extends Fact> = Facts & { readonly [P in K]: NonNullable<Facts[P]> }

type Printed = { readonly value: string; readonly from: readonly Fact[] }
type Missing = { readonly missing: readonly Fact[] }

type AcroDraft = {
  readonly text: Readonly<Record<string, Printed>>
  readonly checks: Readonly<Record<string, string>>
  readonly dropdowns: Readonly<Record<string, Printed>>
}

type DraftBlock =
  | { readonly kind: 'paragraph'; readonly printed: Printed }
  | { readonly kind: 'field'; readonly label: string; readonly printed: Printed }
  | { readonly kind: 'signature'; readonly printed: Printed }

type Box = { readonly field: string; readonly maxLength?: number }

type Seals = (record: OfficialFormRecord) => readonly SensitiveField[]

type CatalogueForm =
  | {
      readonly kind: 'acroform'
      readonly version: string
      readonly title: string
      readonly asset: string
      readonly sha256: string
      readonly boxes: readonly Box[]
      readonly seals: Seals
      readonly fill: (facts: Facts) => AcroDraft | Missing
    }
  | {
      readonly kind: 'composed'
      readonly version: string
      readonly title: string
      readonly seals: Seals
      readonly fill: (facts: Facts) => readonly DraftBlock[] | Missing
    }

type LegalName = Pick<
  Needed<'legalFirstName' | 'legalLastName'>,
  'legalFirstName' | 'legalMiddleName' | 'legalLastName' | 'nameSuffix'
>

const FIELD_ORDER: readonly string[] = [...Object.keys(RECORD_FIELDS), 'hourlyRateCents']

function p(value: string, ...from: Fact[]): Printed {
  return { value, from }
}

function absent(facts: Facts, fields: readonly Fact[]): Fact[] {
  return fields.filter((field) => facts[field] === null)
}

function hasAll<K extends Fact>(facts: Facts, fields: readonly K[]): facts is Needed<K> {
  return fields.every((field) => facts[field] !== null)
}

function middleInitial(middle: string): string {
  return middle.charAt(0)
}

function firstAndInitial(first: string, middle: string | null): Printed {
  return middle === null
    ? p(first, 'legalFirstName')
    : p(`${first} ${middleInitial(middle)}`, 'legalFirstName', 'legalMiddleName')
}

function lastNameBox(last: string, suffix: string | null): Printed {
  return suffix === null ? p(last, 'legalLastName') : p(`${last} ${suffix}`, 'legalLastName', 'nameSuffix')
}

function fullName(name: LegalName): Printed {
  const parts: [string, Fact][] = [[name.legalFirstName, 'legalFirstName']]
  if (name.legalMiddleName !== null) parts.push([name.legalMiddleName, 'legalMiddleName'])
  parts.push([name.legalLastName, 'legalLastName'])
  if (name.nameSuffix !== null) parts.push([name.nameSuffix, 'nameSuffix'])

  return p(parts.map(([value]) => value).join(' '), ...parts.map(([, field]) => field))
}

// Split, never `new Date`: a date-only value must not pass through a timezone.
function usDate(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
}

// IRS rounding: drop amounts under 50 cents, round 50-99 cents up.
function wholeDollars(cents: number): string {
  return String(Math.floor((cents + 50) / 100))
}

function streetLine(address: Address): string {
  return address.line2 === undefined ? address.line1 : `${address.line1}, ${address.line2}`
}

function cityLine(address: Address): string {
  return `${address.city}, ${address.state} ${address.zip}`
}

function otherNamesOrNone(otherNames: readonly string[]): Printed {
  return otherNames.length === 0 ? p('None') : p(otherNames.join(', '), 'otherNames')
}

function whenSet(
  field: string,
  cents: number | null,
  format: (cents: number) => string,
  from: Fact,
): Record<string, Printed> {
  return cents === null ? {} : { [field]: p(format(cents), from) }
}

function field(label: string, printed: Printed): DraftBlock {
  return { kind: 'field', label, printed }
}

const W4 = 'topmostSubform[0].Page1[0].'
const W4_BOX = {
  firstName: `${W4}Step1a[0].f1_01[0]`,
  lastName: `${W4}Step1a[0].f1_02[0]`,
  street: `${W4}Step1a[0].f1_03[0]`,
  city: `${W4}Step1a[0].f1_04[0]`,
  ssn: `${W4}f1_05[0]`,
  dependents: `${W4}f1_08[0]`,
  otherIncome: `${W4}f1_09[0]`,
  deductions: `${W4}f1_10[0]`,
  extraWithholding: `${W4}f1_11[0]`,
  multipleJobs: `${W4}c1_2[0]`,
} as const

const W4_FILING_STATUS_BOX = {
  SINGLE: { field: `${W4}c1_1[0]`, on: '1' },
  MARRIED_FILING_JOINTLY: { field: `${W4}c1_1[1]`, on: '2' },
  HEAD_OF_HOUSEHOLD: { field: `${W4}c1_1[2]`, on: '3' },
} as const satisfies Record<NonNullable<OfficialFormRecord['w4FilingStatus']>, unknown>

function fillW4(facts: Facts): AcroDraft | Missing {
  const needs = [
    'legalFirstName',
    'legalLastName',
    'address',
    'ssn',
    'w4FilingStatus',
    'w4MultipleJobs',
  ] as const
  if (!hasAll(facts, needs)) return { missing: absent(facts, needs) }

  const status = W4_FILING_STATUS_BOX[facts.w4FilingStatus]

  return {
    text: {
      [W4_BOX.firstName]: firstAndInitial(facts.legalFirstName, facts.legalMiddleName),
      [W4_BOX.lastName]: lastNameBox(facts.legalLastName, facts.nameSuffix),
      [W4_BOX.street]: p(streetLine(facts.address), 'address'),
      [W4_BOX.city]: p(cityLine(facts.address), 'address'),
      [W4_BOX.ssn]: p(formatSsn(facts.ssn), 'ssn'),
      ...whenSet(W4_BOX.dependents, facts.w4DependentsAmountCents, wholeDollars, 'w4DependentsAmountCents'),
      ...whenSet(W4_BOX.otherIncome, facts.w4OtherIncomeCents, wholeDollars, 'w4OtherIncomeCents'),
      ...whenSet(W4_BOX.deductions, facts.w4DeductionsCents, wholeDollars, 'w4DeductionsCents'),
      ...whenSet(
        W4_BOX.extraWithholding,
        facts.w4ExtraWithholdingCents,
        wholeDollars,
        'w4ExtraWithholdingCents',
      ),
    },
    checks: {
      [status.field]: status.on,
      ...(facts.w4MultipleJobs ? { [W4_BOX.multipleJobs]: '1' } : {}),
    },
    dropdowns: {},
  }
}

const IT2104_STATUS_ON = {
  SINGLE_OR_HEAD_OF_HOUSEHOLD: 'Single/HOH',
  MARRIED: 'Married',
  MARRIED_WITHHOLD_AT_SINGLE_RATE: 'Higher Rate',
} as const satisfies Record<NonNullable<OfficialFormRecord['it2104FilingStatus']>, string>

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

function fillIt2104(facts: Facts): AcroDraft | Missing {
  const needs = [
    'legalFirstName',
    'legalLastName',
    'address',
    'ssn',
    'it2104FilingStatus',
    'it2104ResidentNyc',
    'it2104ResidentYonkers',
    'it2104AllowancesNy',
  ] as const
  const missing = absent(facts, needs)
  if (facts.it2104ResidentNyc === true && facts.it2104AllowancesNyc === null) {
    missing.push('it2104AllowancesNyc')
  }
  if (missing.length > 0 || !hasAll(facts, needs)) return { missing }

  const line2 = facts.it2104ResidentNyc ? facts.it2104AllowancesNyc : null

  return {
    text: {
      'First name and middle initial': firstAndInitial(facts.legalFirstName, facts.legalMiddleName),
      'Last name': lastNameBox(facts.legalLastName, facts.nameSuffix),
      'Permanent mailing address': p(facts.address.line1, 'address'),
      ...(facts.address.line2 === undefined
        ? {}
        : { 'Apartment number': p(facts.address.line2, 'address') }),
      'City, village or post office': p(facts.address.city, 'address'),
      State: p(facts.address.state, 'address'),
      'ZIP code': p(facts.address.zip, 'address'),
      'Your SSN': p(facts.ssn, 'ssn'),
      'line 1': p(String(facts.it2104AllowancesNy), 'it2104AllowancesNy'),
      ...(line2 === null ? {} : { 'line 2': p(String(line2), 'it2104AllowancesNyc') }),
      ...whenSet('line 3', facts.it2104ExtraWithholdingNyCents, formatCents, 'it2104ExtraWithholdingNyCents'),
    },
    checks: {
      Status: IT2104_STATUS_ON[facts.it2104FilingStatus],
      Resident: yesNo(facts.it2104ResidentNyc),
      'Resident of Yonkers': yesNo(facts.it2104ResidentYonkers),
    },
    dropdowns: {},
  }
}

const I9_ATTESTATION = {
  US_CITIZEN: { box: 'CB_1', numberBox: null, expires: false },
  NONCITIZEN_NATIONAL: { box: 'CB_2', numberBox: null, expires: false },
  PERMANENT_RESIDENT: {
    box: 'CB_3',
    numberBox: '3 A lawful permanent resident Enter USCIS or ANumber',
    expires: false,
  },
  AUTHORIZED_ALIEN_USCIS_NUMBER: { box: 'CB_4', numberBox: 'USCIS ANumber', expires: true },
  AUTHORIZED_ALIEN_I94_NUMBER: { box: 'CB_4', numberBox: 'Form I94 Admission Number', expires: true },
} as const satisfies Record<
  NonNullable<OfficialFormRecord['workAuthorizationType']>,
  { box: string; numberBox: string | null; expires: boolean }
>

// The SSN, e-mail and phone are voluntary on I-9 §1 for an employer not using E-Verify (T-061
// Question 1), so none of them is printed.
function fillI9Section1(facts: Facts): AcroDraft | Missing {
  const needs = [
    'legalFirstName',
    'legalLastName',
    'address',
    'dateOfBirth',
    'workAuthorizationType',
  ] as const
  const missing = absent(facts, needs)
  const attestation =
    facts.workAuthorizationType === null ? null : I9_ATTESTATION[facts.workAuthorizationType]
  if (
    attestation !== null &&
    attestation.numberBox !== null &&
    facts.workAuthorizationNumber === null
  ) {
    missing.push('workAuthorizationNumber')
  }
  if (missing.length > 0 || !hasAll(facts, needs)) return { missing }

  const { box, numberBox, expires } = I9_ATTESTATION[facts.workAuthorizationType]
  const number = facts.workAuthorizationNumber

  return {
    text: {
      'Last Name (Family Name)': lastNameBox(facts.legalLastName, facts.nameSuffix),
      'First Name Given Name': p(facts.legalFirstName, 'legalFirstName'),
      ...(facts.legalMiddleName === null
        ? {}
        : {
            'Employee Middle Initial (if any)': p(
              middleInitial(facts.legalMiddleName),
              'legalMiddleName',
            ),
          }),
      ...(facts.otherNames.length === 0
        ? {}
        : { 'Employee Other Last Names Used (if any)': p(facts.otherNames.join(', '), 'otherNames') }),
      'Address Street Number and Name': p(facts.address.line1, 'address'),
      ...(facts.address.line2 === undefined
        ? {}
        : { 'Apt Number (if any)': p(facts.address.line2, 'address') }),
      'City or Town': p(facts.address.city, 'address'),
      // The I-9 ZIP box takes five digits; a stored ZIP+4 prints its first five.
      'ZIP Code': p(facts.address.zip.slice(0, 5), 'address'),
      'Date of Birth mmddyyyy': p(usDate(facts.dateOfBirth), 'dateOfBirth'),
      ...(numberBox === null || number === null
        ? {}
        : { [numberBox]: p(number, 'workAuthorizationNumber') }),
      ...(expires
        ? {
            'Exp Date mmddyyyy':
              facts.workAuthorizationExpiresAt === null
                ? p('N/A')
                : p(usDate(facts.workAuthorizationExpiresAt), 'workAuthorizationExpiresAt'),
          }
        : {}),
    },
    checks: { [box]: 'On' },
    dropdowns: { State: p(facts.address.state, 'address') },
  }
}

// Only what the record holds: the employer's address, FEIN, payday and pay frequency stay blank
// for the agency to complete (T-061 Question 5). LS 54 prints the "$" before both rate boxes.
function fillWageNotice(facts: Facts): AcroDraft | Missing {
  const needs = ['legalFirstName', 'legalLastName', 'hourlyRateCents'] as const
  if (!hasAll(facts, needs)) return { missing: absent(facts, needs) }

  return {
    text: {
      Apprenticeship_ApplicantNotification_EmployerName: p(facts.agencyName),
      Business_EmployeeName: fullName(facts),
      Employment_RegularRates_PerRate1: p(formatCents(facts.hourlyRateCents), 'hourlyRateCents'),
      ...(facts.overtimeRateCents === null
        ? {}
        : { WorkHistory_JobInfo_PerTime1: p(formatCents(facts.overtimeRateCents)) }),
    },
    checks: { Generic_GenericYesNo_Yes16: 'Generic_GenericYesNo_Yes16' },
    dropdowns: {},
  }
}

// Mother's maiden name and DOH's conviction and abuse certifications are not captured, so this
// SAMPLE prints none of them (T-061 Question 2).
function fillChrc102(facts: Facts): readonly DraftBlock[] | Missing {
  const needs = ['legalFirstName', 'legalLastName', 'dateOfBirth', 'address'] as const
  if (!hasAll(facts, needs)) return { missing: absent(facts, needs) }

  return [
    field('Last name', lastNameBox(facts.legalLastName, facts.nameSuffix)),
    field('First name', p(facts.legalFirstName, 'legalFirstName')),
    field(
      'Middle initial',
      facts.legalMiddleName === null
        ? p('')
        : p(middleInitial(facts.legalMiddleName), 'legalMiddleName'),
    ),
    field('Date of birth', p(usDate(facts.dateOfBirth), 'dateOfBirth')),
    field('Other names used', otherNamesOrNone(facts.otherNames)),
    field('Mailing address', p(`${streetLine(facts.address)}, ${cityLine(facts.address)}`, 'address')),
    { kind: 'signature', printed: fullName(facts) },
  ]
}

const SEX_LABELS = { F: 'Female', M: 'Male', X: 'X' } as const satisfies Record<
  NonNullable<OfficialFormRecord['sex']>,
  string
>

const EYE_COLOR_LABELS = {
  BLK: 'Black',
  BLU: 'Blue',
  BRO: 'Brown',
  GRN: 'Green',
  GRY: 'Gray',
  HAZ: 'Hazel',
  MAR: 'Maroon',
  MUL: 'Multicolored',
  PNK: 'Pink',
} as const satisfies Record<NonNullable<OfficialFormRecord['eyeColor']>, string>

const HAIR_COLOR_LABELS = {
  BAL: 'Bald',
  BLK: 'Black',
  BLN: 'Blond or strawberry',
  BRO: 'Brown',
  GRY: 'Gray or partially gray',
  RED: 'Red or auburn',
  SDY: 'Sandy',
  WHI: 'White',
} as const satisfies Record<NonNullable<OfficialFormRecord['hairColor']>, string>

// No SSN and no race: race is EEOC-restricted and never reaches a document.
function fillFingerprintQuestionnaire(facts: Facts): readonly DraftBlock[] | Missing {
  const needs = [
    'legalFirstName',
    'legalLastName',
    'dateOfBirth',
    'sex',
    'heightInches',
    'weightPounds',
    'eyeColor',
    'hairColor',
    'countryOfBirth',
  ] as const
  if (!hasAll(facts, needs)) return { missing: absent(facts, needs) }

  const feet = Math.floor(facts.heightInches / 12)
  const inches = facts.heightInches % 12

  return [
    field('Legal name', fullName(facts)),
    field('Other names used', otherNamesOrNone(facts.otherNames)),
    field('Date of birth', p(usDate(facts.dateOfBirth), 'dateOfBirth')),
    field('Sex', p(SEX_LABELS[facts.sex], 'sex')),
    field('Height', p(`${feet} ft ${inches} in`, 'heightInches')),
    field('Weight', p(`${facts.weightPounds} lb`, 'weightPounds')),
    field('Eye color', p(`${EYE_COLOR_LABELS[facts.eyeColor]} (${facts.eyeColor})`, 'eyeColor')),
    field('Hair color', p(`${HAIR_COLOR_LABELS[facts.hairColor]} (${facts.hairColor})`, 'hairColor')),
    field('Country of birth', p(facts.countryOfBirth, 'countryOfBirth')),
    { kind: 'signature', printed: fullName(facts) },
  ]
}

const ACCOUNT_TYPE_LABELS = { CHECKING: 'Checking', SAVINGS: 'Savings' } as const satisfies Record<
  NonNullable<OfficialFormRecord['bankAccountType']>,
  string
>

function fillDirectDeposit(facts: Facts): readonly DraftBlock[] | Missing {
  const needs = [
    'legalFirstName',
    'legalLastName',
    'bankName',
    'bankAccountType',
    'bankRoutingNumber',
    'bankAccountNumber',
  ] as const
  if (!hasAll(facts, needs)) return { missing: absent(facts, needs) }

  return [
    {
      kind: 'paragraph',
      printed: p(`I authorize ${facts.agencyName} to deposit my pay into the account below.`),
    },
    field('Employee', fullName(facts)),
    field('Bank', p(facts.bankName, 'bankName')),
    field('Account type', p(ACCOUNT_TYPE_LABELS[facts.bankAccountType], 'bankAccountType')),
    field('Routing number', p(facts.bankRoutingNumber, 'bankRoutingNumber')),
    field('Account number', p(facts.bankAccountNumber, 'bankAccountNumber')),
    { kind: 'signature', printed: fullName(facts) },
  ]
}

const noSeals: Seals = () => []

const CATALOGUE = new Map<string, CatalogueForm>([
  [
    DOCUMENT_KEYS.W_4,
    {
      kind: 'acroform',
      version: '2026.1',
      title: 'Form W-4 (2026)',
      asset: 'fw4-2026.pdf',
      sha256: '92444d8856ce55d9e25dca8b6d1420634fc68b11e1ab1f760916ea29ddd312b2',
      boxes: [
        { field: W4_BOX.firstName },
        { field: W4_BOX.lastName },
        { field: W4_BOX.street },
        { field: W4_BOX.city },
        { field: W4_BOX.ssn, maxLength: 11 },
        { field: W4_BOX.dependents },
        { field: W4_BOX.otherIncome },
        { field: W4_BOX.deductions },
        { field: W4_BOX.extraWithholding },
      ],
      seals: () => ['ssn'],
      fill: fillW4,
    },
  ],
  [
    DOCUMENT_KEYS.NY_IT_2104,
    {
      kind: 'acroform',
      version: '2026.1',
      title: 'Form IT-2104 (2026)',
      asset: 'it2104-2026.pdf',
      sha256: '04eb718666ba50f87183daf1581489354a23ac55b7f66997a8b10913a70dbea7',
      boxes: [
        { field: 'First name and middle initial', maxLength: 40 },
        { field: 'Last name', maxLength: 30 },
        { field: 'Permanent mailing address', maxLength: 55 },
        { field: 'Apartment number', maxLength: 10 },
        { field: 'City, village or post office', maxLength: 40 },
        { field: 'State', maxLength: 2 },
        { field: 'ZIP code', maxLength: 10 },
        { field: 'Your SSN', maxLength: 9 },
        { field: 'line 1', maxLength: 2 },
        { field: 'line 2', maxLength: 2 },
        { field: 'line 3', maxLength: 8 },
      ],
      seals: () => ['ssn'],
      fill: fillIt2104,
    },
  ],
  [
    DOCUMENT_KEYS.I9_SECTION_1,
    {
      kind: 'acroform',
      version: '2025-01-20.2',
      title: 'Form I-9, Section 1 (01/20/25)',
      asset: 'i9-2025-01-20.pdf',
      sha256: '780f348c34df694bb0b4dbbfaf9f22b99b9757b80d16a37ba89aadf069597281',
      boxes: [
        { field: 'Last Name (Family Name)' },
        { field: 'First Name Given Name' },
        { field: 'Employee Middle Initial (if any)', maxLength: 1 },
        { field: 'Employee Other Last Names Used (if any)' },
        { field: 'Address Street Number and Name' },
        { field: 'Apt Number (if any)' },
        { field: 'City or Town' },
        { field: 'ZIP Code', maxLength: 6 },
        { field: 'Date of Birth mmddyyyy' },
        { field: '3 A lawful permanent resident Enter USCIS or ANumber' },
        { field: 'USCIS ANumber', maxLength: 10 },
        { field: 'Form I94 Admission Number', maxLength: 11 },
        { field: 'Exp Date mmddyyyy' },
      ],
      seals: (record) =>
        record.workAuthorizationType !== null &&
        I9_ATTESTATION[record.workAuthorizationType].numberBox !== null
          ? ['workAuthorizationNumber']
          : [],
      fill: fillI9Section1,
    },
  ],
  [
    DOCUMENT_KEYS.NY_WAGE_NOTICE,
    {
      kind: 'acroform',
      version: '2025-12.1',
      title: 'NY Pay Notice for Hourly Rate Employees (LS 54)',
      asset: 'ls54-2025-12.pdf',
      sha256: '96f33a56a4f034af8962f4e3714e8d11f0234906e3d54f02259110cf2d4881fd',
      boxes: [
        { field: 'Apprenticeship_ApplicantNotification_EmployerName' },
        { field: 'Business_EmployeeName' },
        { field: 'Employment_RegularRates_PerRate1' },
        { field: 'WorkHistory_JobInfo_PerTime1' },
      ],
      seals: noSeals,
      fill: fillWageNotice,
    },
  ],
  [
    DOCUMENT_KEYS.CHRC_102,
    {
      kind: 'composed',
      version: '1',
      title: 'CHRC-102 consent (SAMPLE)',
      seals: noSeals,
      fill: fillChrc102,
    },
  ],
  [
    DOCUMENT_KEYS.CHRC_FINGERPRINT_QUESTIONNAIRE,
    {
      kind: 'composed',
      version: '1',
      title: 'Fingerprint questionnaire (SAMPLE)',
      seals: noSeals,
      fill: fillFingerprintQuestionnaire,
    },
  ],
  [
    DOCUMENT_KEYS.DIRECT_DEPOSIT_ELECTION,
    {
      kind: 'composed',
      version: '1',
      title: 'Direct deposit election (SAMPLE)',
      seals: () => ['bankRoutingNumber', 'bankAccountNumber'],
      fill: fillDirectDeposit,
    },
  ],
])

export function hasOfficialForm(documentKey: string): boolean {
  return CATALOGUE.has(documentKey)
}

export function sealedFieldsFor(
  entries: readonly DocumentSetEntry[],
  record: OfficialFormRecord,
): readonly SensitiveField[] {
  const wanted = new Set(
    entries.flatMap((entry) => CATALOGUE.get(entry.documentKey)?.seals(record) ?? []),
  )
  return SENSITIVE_FIELDS.filter((sensitive) => wanted.has(sensitive))
}

function refusal(
  documentKey: string,
  reason: 'missing-fields' | 'unprintable' | 'does-not-fit',
  fields: readonly OfficialFormField[],
): OfficialFormRefusal {
  const ordered = [...new Set(fields)].sort((a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))
  return { documentKey, reason, fields: ordered }
}

function values(printed: Readonly<Record<string, Printed>>): Record<string, string> {
  return Object.fromEntries(Object.entries(printed).map(([name, { value }]) => [name, value]))
}

function factText(value: Facts[Fact]): string {
  if (value === null) return ''
  return typeof value === 'object' ? Object.values(value).join(' ') : String(value)
}

// A box built from several fields names only the ones that cannot print.
function unprintable(printed: readonly Printed[], facts: Facts): Fact[] {
  return printed
    .filter(({ value }) => !isWinAnsi(value))
    .flatMap(({ from }) => {
      const culprits = from.filter((name) => !isWinAnsi(factText(facts[name])))
      return culprits.length > 0 ? culprits : from
    })
}

function toRenderedBlock(block: DraftBlock): RenderedBlock {
  switch (block.kind) {
    case 'paragraph':
      return { kind: 'paragraph', text: block.printed.value }
    case 'field':
      return { kind: 'field', label: block.label, value: block.printed.value }
    case 'signature':
      return { kind: 'signature', signerName: block.printed.value }
  }
}

function fillForm(
  documentKey: string,
  form: CatalogueForm,
  facts: Facts,
): OfficialFormFill | OfficialFormRefusal {
  if (form.kind === 'acroform') {
    const draft = form.fill(facts)
    if ('missing' in draft) return refusal(documentKey, 'missing-fields', draft.missing)

    const bad = unprintable([...Object.values(draft.text), ...Object.values(draft.dropdowns)], facts)
    if (bad.length > 0) return refusal(documentKey, 'unprintable', bad)

    const tooLong = Object.entries(draft.text).flatMap(([name, { value, from }]) => {
      const maxLength = form.boxes.find((box) => box.field === name)?.maxLength
      return maxLength !== undefined && value.length > maxLength ? from : []
    })
    if (tooLong.length > 0) return refusal(documentKey, 'does-not-fit', tooLong)

    return {
      kind: 'acroform',
      documentKey,
      templateVersion: form.version,
      title: form.title,
      asset: form.asset,
      text: values(draft.text),
      checks: draft.checks,
      dropdowns: values(draft.dropdowns),
    }
  }

  const drafted = form.fill(facts)
  if ('missing' in drafted) return refusal(documentKey, 'missing-fields', drafted.missing)

  const blocks: readonly DraftBlock[] = [
    {
      kind: 'paragraph',
      printed: p(
        `SAMPLE — this is not the official form. ${facts.agencyName} must replace it with the approved form before use.`,
      ),
    },
    ...drafted,
  ]
  const bad = unprintable(
    blocks.map(({ printed }) => printed),
    facts,
  )
  if (bad.length > 0) return refusal(documentKey, 'unprintable', bad)

  return {
    kind: 'composed',
    document: {
      documentKey,
      templateVersion: form.version,
      title: form.title,
      blocks: blocks.map(toRenderedBlock),
    },
  }
}

export function fillOfficialForms(
  entries: readonly DocumentSetEntry[],
  record: OfficialFormRecord,
  sealed: SealedFormValues,
): OfficialFormsFillResult {
  const facts: Facts = {
    ...record,
    ssn: sealed.ssn ?? null,
    bankAccountNumber: sealed.bankAccountNumber ?? null,
    bankRoutingNumber: sealed.bankRoutingNumber ?? null,
    workAuthorizationNumber: sealed.workAuthorizationNumber ?? null,
  }
  const fills: OfficialFormFill[] = []
  const refusals: OfficialFormRefusal[] = []

  for (const { documentKey } of entries) {
    const form = CATALOGUE.get(documentKey)
    const result: OfficialFormFill | OfficialFormRefusal =
      form === undefined ? { documentKey, reason: 'no-template' } : fillForm(documentKey, form, facts)
    if ('reason' in result) refusals.push(result)
    else fills.push(result)
  }

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, fills }
}
