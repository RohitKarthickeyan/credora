import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { BANK_ACCOUNT_TYPES, IT2104_FILING_STATUSES, W4_FILING_STATUSES } from '../canonical-record'
import type { FormSection } from '../definition'

const REQUIRED_BY = [INTAKE_REQUIREMENT_KEYS.PAYROLL] as const
const MAX_CENTS = 100_000_000

const W4_FILING_STATUS_LABELS: Record<(typeof W4_FILING_STATUSES)[number], string> = {
  SINGLE: 'Single or married filing separately',
  MARRIED_FILING_JOINTLY: 'Married filing jointly or qualifying surviving spouse',
  HEAD_OF_HOUSEHOLD: 'Head of household',
}

const IT2104_FILING_STATUS_LABELS: Record<(typeof IT2104_FILING_STATUSES)[number], string> = {
  SINGLE_OR_HEAD_OF_HOUSEHOLD: 'Single or head of household',
  MARRIED: 'Married',
  MARRIED_WITHHOLD_AT_SINGLE_RATE: 'Married, but withhold at the higher single rate',
}

const BANK_ACCOUNT_TYPE_LABELS: Record<(typeof BANK_ACCOUNT_TYPES)[number], string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
}

export const PAYROLL_W4_SECTION: FormSection = {
  id: 'payroll-w4',
  title: 'Federal tax withholding (W-4)',
  requiredBy: REQUIRED_BY,
  items: [
    {
      kind: 'select',
      id: 'w4FilingStatus',
      label: 'Filing status (Step 1)',
      options: W4_FILING_STATUSES.map((value) => ({ value, label: W4_FILING_STATUS_LABELS[value] })),
    },
    {
      kind: 'yesNo',
      id: 'w4MultipleJobs',
      label: 'Do you have more than one job, or does your spouse also work? (Step 2)',
    },
    {
      kind: 'money',
      id: 'w4DependentsAmountCents',
      label: 'Total amount for dependents, in dollars (Step 3)',
      maxCents: MAX_CENTS,
      optional: true,
    },
    {
      kind: 'money',
      id: 'w4OtherIncomeCents',
      label: 'Other income not from jobs, in dollars (Step 4(a))',
      maxCents: MAX_CENTS,
      optional: true,
    },
    {
      kind: 'money',
      id: 'w4DeductionsCents',
      label: 'Deductions, in dollars (Step 4(b))',
      maxCents: MAX_CENTS,
      optional: true,
    },
    {
      kind: 'money',
      id: 'w4ExtraWithholdingCents',
      label: 'Extra withholding each pay period, in dollars (Step 4(c))',
      maxCents: MAX_CENTS,
      optional: true,
    },
  ],
}

// IT-2104 line 1 is one number "for New York State and Yonkers", so it2104AllowancesYonkers is
// deliberately not asked.
export const PAYROLL_IT2104_SECTION: FormSection = {
  id: 'payroll-it2104',
  title: 'New York tax withholding (IT-2104)',
  requiredBy: REQUIRED_BY,
  items: [
    {
      kind: 'select',
      id: 'it2104FilingStatus',
      label: 'Filing status',
      options: IT2104_FILING_STATUSES.map((value) => ({ value, label: IT2104_FILING_STATUS_LABELS[value] })),
    },
    { kind: 'yesNo', id: 'it2104ResidentNyc', label: 'Do you live in New York City?' },
    { kind: 'yesNo', id: 'it2104ResidentYonkers', label: 'Do you live in Yonkers?' },
    {
      kind: 'integer',
      id: 'it2104AllowancesNy',
      label: 'Allowances for New York State and Yonkers',
      min: 0,
      max: 99,
    },
    {
      kind: 'integer',
      id: 'it2104AllowancesNyc',
      label: 'Allowances for New York City',
      min: 0,
      max: 99,
      visibleWhen: { field: 'it2104ResidentNyc', equals: 'yes' },
    },
    {
      kind: 'money',
      id: 'it2104ExtraWithholdingNyCents',
      label: 'Extra New York State withholding each pay period, in dollars',
      maxCents: MAX_CENTS,
      optional: true,
    },
  ],
}

export const PAYROLL_DIRECT_DEPOSIT_SECTION: FormSection = {
  id: 'payroll-direct-deposit',
  title: 'Direct deposit',
  requiredBy: REQUIRED_BY,
  items: [
    { kind: 'text', id: 'bankName', label: 'Bank name', maxLength: 100 },
    {
      kind: 'select',
      id: 'bankAccountType',
      label: 'Account type',
      options: BANK_ACCOUNT_TYPES.map((value) => ({ value, label: BANK_ACCOUNT_TYPE_LABELS[value] })),
    },
    { kind: 'routingNumber', id: 'bankRoutingNumber', label: 'Routing number' },
    { kind: 'accountNumber', id: 'bankAccountNumber', label: 'Account number' },
  ],
}
