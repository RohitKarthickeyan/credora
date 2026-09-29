import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { US_STATE_CODES } from '@/domain/validation/address'
import { WORK_AUTHORIZATION_TYPES } from '../canonical-record'
import type { FormSection } from '../definition'

// The I-9 §1 attestation wording.
const WORK_AUTHORIZATION_LABELS: Record<(typeof WORK_AUTHORIZATION_TYPES)[number], string> = {
  US_CITIZEN: 'A citizen of the United States',
  NONCITIZEN_NATIONAL: 'A noncitizen national of the United States',
  PERMANENT_RESIDENT: 'A lawful permanent resident (USCIS A-Number)',
  AUTHORIZED_ALIEN_USCIS_NUMBER: 'A noncitizen authorized to work — I have a USCIS A-Number',
  AUTHORIZED_ALIEN_I94_NUMBER: 'A noncitizen authorized to work — I have a Form I-94 admission number',
}

const HAS_LICENSE = { field: 'hasDriversLicense', equals: 'yes' } as const

export const GOVERNMENT_ID_SECTION: FormSection = {
  id: 'government-id',
  title: 'ID and work authorization',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.GOVERNMENT_ID],
  items: [
    { kind: 'yesNo', id: 'hasDriversLicense', label: "Do you have a driver's license?" },
    {
      kind: 'text',
      id: 'driversLicenseNumber',
      label: "Driver's license number",
      maxLength: 25,
      visibleWhen: HAS_LICENSE,
    },
    {
      kind: 'select',
      id: 'driversLicenseState',
      label: 'State that issued it',
      options: US_STATE_CODES.map((value) => ({ value, label: value })),
      visibleWhen: HAS_LICENSE,
    },
    { kind: 'date', id: 'driversLicenseExpiresAt', label: 'License expiration date', visibleWhen: HAS_LICENSE },
    {
      kind: 'select',
      id: 'workAuthorizationType',
      label: 'I am',
      options: WORK_AUTHORIZATION_TYPES.map((value) => ({ value, label: WORK_AUTHORIZATION_LABELS[value] })),
    },
    {
      kind: 'documentNumber',
      id: 'workAuthorizationNumber',
      label: 'USCIS A-Number or Form I-94 admission number',
      visibleWhen: {
        field: 'workAuthorizationType',
        equals: ['PERMANENT_RESIDENT', 'AUTHORIZED_ALIEN_USCIS_NUMBER', 'AUTHORIZED_ALIEN_I94_NUMBER'],
      },
    },
    {
      kind: 'date',
      id: 'workAuthorizationExpiresAt',
      label: 'Work authorization expiration date',
      hint: 'If your authorization has an expiration date.',
      optional: true,
      visibleWhen: {
        field: 'workAuthorizationType',
        equals: ['AUTHORIZED_ALIEN_USCIS_NUMBER', 'AUTHORIZED_ALIEN_I94_NUMBER'],
      },
    },
  ],
}
