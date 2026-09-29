import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { MARITAL_STATUSES, SEX_MARKERS } from '../canonical-record'
import type { FormSection } from '../definition'

const SEX_LABELS: Record<(typeof SEX_MARKERS)[number], string> = { F: 'Female', M: 'Male', X: 'X' }

const MARITAL_STATUS_LABELS: Record<(typeof MARITAL_STATUSES)[number], string> = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  DIVORCED: 'Divorced',
  SEPARATED: 'Separated',
  WIDOWED: 'Widowed',
}

export const IDENTITY_SECTION: FormSection = {
  id: 'identity',
  title: 'About you',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.IDENTITY],
  items: [
    {
      kind: 'personName',
      id: 'legalFirstName',
      label: 'Legal first name',
      hint: 'Exactly as on your Social Security card.',
    },
    { kind: 'personName', id: 'legalMiddleName', label: 'Middle name', optional: true },
    { kind: 'personName', id: 'legalLastName', label: 'Legal last name' },
    { kind: 'personName', id: 'nameSuffix', label: 'Suffix', hint: 'For example Jr. or III.', optional: true },
    {
      kind: 'nameList',
      id: 'otherNames',
      label: 'Other names you have used, including maiden names',
      hint: 'Separate with commas.',
      maxItems: 5,
      optional: true,
    },
    { kind: 'dateOfBirth', id: 'dateOfBirth', label: 'Date of birth' },
    { kind: 'ssn', id: 'ssn', label: 'Social Security number' },
    {
      kind: 'select',
      id: 'sex',
      label: 'Sex',
      hint: 'As shown on your ID.',
      options: SEX_MARKERS.map((value) => ({ value, label: SEX_LABELS[value] })),
    },
    {
      kind: 'select',
      id: 'maritalStatus',
      label: 'Marital status',
      optional: true,
      options: MARITAL_STATUSES.map((value) => ({ value, label: MARITAL_STATUS_LABELS[value] })),
    },
    { kind: 'text', id: 'countryOfBirth', label: 'Country of birth', maxLength: 60 },
  ],
}
