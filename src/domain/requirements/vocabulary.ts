// The scope-axis values and the key names other tasks must type. Importing them turns a typo into
// a build error: a section whose `requiredBy` key no template seeds is silently never shown
// (ADR-034), and a document key with no generator fails only at send time (T-064).

// Service type is the aide service the caregiver is hired to deliver. Role is the certification
// they hold, lowest to highest, and caregiverRoleOf picks the highest declared. Payer is private
// pay only: V1 covers private-duty agencies.
export const STATES = ['NY'] as const
export const SERVICE_TYPES = ['HHA', 'PCA'] as const
export const PAYERS = ['PRIVATE_PAY'] as const
export const CAREGIVER_ROLES = ['PCA', 'HHA', 'CNA'] as const
export type CaregiverRole = (typeof CAREGIVER_ROLES)[number]

export const INTAKE_REQUIREMENT_KEYS = {
  IDENTITY: 'INTAKE_IDENTITY',
  CONTACT: 'INTAKE_CONTACT',
  GOVERNMENT_ID: 'INTAKE_GOVERNMENT_ID',
  CHRC_DESCRIPTORS: 'INTAKE_CHRC_DESCRIPTORS',
  PAYROLL: 'INTAKE_PAYROLL',
  EMPLOYMENT_HISTORY: 'INTAKE_EMPLOYMENT_HISTORY',
  EDUCATION: 'INTAKE_EDUCATION',
  REFERENCES: 'INTAKE_REFERENCES',
  EMERGENCY_CONTACTS: 'INTAKE_EMERGENCY_CONTACTS',
  HOME_CARE_PROFILE: 'INTAKE_HOME_CARE_PROFILE',
  MEDICAL_QUESTIONNAIRE: 'INTAKE_MEDICAL_QUESTIONNAIRE',
  EEOC_SELF_IDENTIFICATION: 'INTAKE_EEOC_SELF_IDENTIFICATION',
} as const

// The `evidenceKey` of every SIGNED_DOCUMENT option in the NY library (ADR-037).
export const DOCUMENT_KEYS = {
  // official forms (T-061)
  W_4: 'W_4',
  NY_IT_2104: 'NY_IT_2104',
  I9_SECTION_1: 'I9_SECTION_1',
  CHRC_102: 'CHRC_102',
  CHRC_FINGERPRINT_QUESTIONNAIRE: 'CHRC_FINGERPRINT_QUESTIONNAIRE',
  NY_WAGE_NOTICE: 'NY_WAGE_NOTICE',
  DIRECT_DEPOSIT_ELECTION: 'DIRECT_DEPOSIT_ELECTION',
  // agency documents (T-062)
  EMPLOYMENT_APPLICATION: 'EMPLOYMENT_APPLICATION',
  OFFER_LETTER: 'OFFER_LETTER',
  HHA_JOB_DESCRIPTION: 'HHA_JOB_DESCRIPTION',
  PCA_JOB_DESCRIPTION: 'PCA_JOB_DESCRIPTION',
  WORKER_AGREEMENT: 'WORKER_AGREEMENT',
  // vaccination statements (type FORM; T-084)
  HEPATITIS_B_CONSENT_OR_DECLINATION: 'HEPATITIS_B_CONSENT_OR_DECLINATION',
  FLU_VACCINATION_STATEMENT: 'FLU_VACCINATION_STATEMENT',
  // sign-only (type ATTESTATION; T-062)
  PHI_ACKNOWLEDGEMENT: 'PHI_ACKNOWLEDGEMENT',
  FCRA_DISCLOSURE: 'FCRA_DISCLOSURE',
} as const
