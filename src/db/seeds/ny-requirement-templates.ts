import {
  REFERENCE_CHECK_REQUIREMENT_KEY,
  REFERENCE_CHECK_RESULT_EVIDENCE_KEY,
} from '@/domain/requirements/reference-check'
import type { ResolutionContext } from '@/domain/requirements/resolve'
import type { EvidenceKind } from '@/domain/requirements/template'
import { DOCUMENT_KEYS, INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { CorePrismaClient } from '../prisma'
import type { PublishRequirementTemplateInput } from '../repositories/requirement-templates'
import {
  publishRequirementTemplateIfChanged,
  retirePlatformTemplatesNotIn,
} from '../repositories/requirement-template-writer'

// Value imports only from @/domain/ and the writer: `tsx prisma/seed.ts` (T-132) loads this
// module and cannot resolve `server-only` (ADR-054). The client is a parameter for the same
// reason. Seeds write no audit entry, as seedNyAcceptedIssuers writes none: a seed runs outside
// any request.

// Every platform scope carries `state`, so a service-type rule strictly contains the state rule
// with the same key and never ties with it (OPEN-QUESTIONS 28).
const NY: ResolutionContext = { state: 'NY' }
const NY_HHA: ResolutionContext = { state: 'NY', serviceType: 'HHA' }
const NY_PCA: ResolutionContext = { state: 'NY', serviceType: 'PCA' }
const AGENCY_WIDE: ResolutionContext = {}

type Option = { readonly kind: EvidenceKind; readonly evidenceKey: string; readonly label: string }

export const PERMANENT = {
  validityRule: 'NEVER_EXPIRES',
  validityMonths: null,
  renewalRule: 'NONE',
  manualOnlyReason: null,
} as const

export const YEARLY = {
  validityRule: 'FIXED_PERIOD',
  validityMonths: 12,
  renewalRule: 'ANNUAL',
  manualOnlyReason: null,
} as const

export function option(kind: EvidenceKind, evidenceKey: string, label: string): Option {
  return { kind, evidenceKey, label }
}

// An intake section is satisfied by the caregiver submitting it as true and complete. It is never
// a document, because the document set emits only SIGNED_DOCUMENT options.
function intake(
  key: string,
  scope: ResolutionContext,
  name: string,
  description: string,
): PublishRequirementTemplateInput {
  return {
    ...PERMANENT,
    key,
    scope,
    name,
    description,
    type: 'FORM',
    acceptedEvidence: [
      option('ATTESTATION', `${key}_SUBMITTED`, `I confirm my ${name.toLowerCase()} is complete.`),
    ],
  }
}

function signedForm(
  documentKey: string,
  name: string,
  description: string,
  label: string,
): PublishRequirementTemplateInput {
  return {
    ...PERMANENT,
    key: documentKey,
    scope: NY,
    name,
    description,
    type: 'FORM',
    acceptedEvidence: [option('SIGNED_DOCUMENT', documentKey, label)],
  }
}

const NY_PLATFORM_TEMPLATES: readonly PublishRequirementTemplateInput[] = [
  intake(
    INTAKE_REQUIREMENT_KEYS.IDENTITY,
    NY,
    'Identity details',
    'Legal name, date of birth and Social Security number, as used on every official form.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.CONTACT,
    NY,
    'Contact details',
    'Home address, phone numbers and email address.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.GOVERNMENT_ID,
    NY,
    'Government ID details',
    'The type, number, issuer and expiry of a government-issued photo ID.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.CHRC_DESCRIPTORS,
    NY,
    'Fingerprint check details',
    'The descriptors the NY DOH criminal history record check asks for.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.PAYROLL,
    NY,
    'Payroll details',
    'Tax withholding elections and direct deposit bank details.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.EMPLOYMENT_HISTORY,
    NY,
    'Employment history',
    'Past employers, dates of employment and reasons for leaving.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.EDUCATION,
    NY,
    'Education history',
    'Schools attended and qualifications earned.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.REFERENCES,
    NY,
    'Professional references',
    'Past employers or supervisors who can be contacted for a reference.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.HOME_CARE_PROFILE,
    NY,
    'Home care profile',
    'Availability, languages, care preferences and COVID vaccination status.',
  ),
  intake(
    INTAKE_REQUIREMENT_KEYS.MEDICAL_QUESTIONNAIRE,
    NY,
    'Medical questionnaire',
    'The health history questions asked before the pre-employment physical.',
  ),
  signedForm(
    DOCUMENT_KEYS.EMPLOYMENT_APPLICATION,
    'Employment application',
    'A signed application for employment with the agency.',
    'Signed employment application.',
  ),
  signedForm(
    DOCUMENT_KEYS.OFFER_LETTER,
    'Offer letter',
    'A signed acceptance of the written offer of employment.',
    'Signed offer letter.',
  ),
  {
    ...PERMANENT,
    key: 'JOB_DESCRIPTION',
    scope: NY_HHA,
    name: 'Job description',
    description: 'A signed acknowledgement of the home health aide job description.',
    type: 'FORM',
    acceptedEvidence: [
      option(
        'SIGNED_DOCUMENT',
        DOCUMENT_KEYS.HHA_JOB_DESCRIPTION,
        'Signed home health aide job description.',
      ),
    ],
  },
  {
    ...PERMANENT,
    key: 'JOB_DESCRIPTION',
    scope: NY_PCA,
    name: 'Job description',
    description: 'A signed acknowledgement of the personal care aide job description.',
    type: 'FORM',
    acceptedEvidence: [
      option(
        'SIGNED_DOCUMENT',
        DOCUMENT_KEYS.PCA_JOB_DESCRIPTION,
        'Signed personal care aide job description.',
      ),
    ],
  },
  signedForm(
    DOCUMENT_KEYS.WORKER_AGREEMENT,
    'Worker agreement',
    'A signed agreement setting out the terms of work with the agency.',
    'Signed worker agreement.',
  ),
  signedForm(
    DOCUMENT_KEYS.W_4,
    'Federal W-4',
    'The federal employee withholding certificate, completed and signed.',
    'Signed W-4.',
  ),
  signedForm(
    DOCUMENT_KEYS.NY_IT_2104,
    'NY IT-2104',
    'The New York State employee withholding allowance certificate, completed and signed.',
    'Signed IT-2104.',
  ),
  signedForm(
    DOCUMENT_KEYS.I9_SECTION_1,
    'I-9 Section 1',
    'Section 1 of the federal employment eligibility verification form, completed and signed.',
    'Signed I-9 Section 1.',
  ),
  {
    ...PERMANENT,
    key: 'I9_SECTION_2',
    scope: NY,
    name: 'I-9 Section 2',
    description:
      'An employer representative examines the original identity and work authorization ' +
      'documents and completes Section 2 of the I-9.',
    type: 'CHECK',
    acceptedEvidence: [
      option('CHECK_RESULT', 'I9_SECTION_2_EXAMINATION', 'I-9 Section 2 document examination.'),
    ],
    manualOnly: true,
    manualOnlyReason:
      'I-9 §2 requires a person to examine the documents. There is no auto-accept path.',
  },
  signedForm(
    DOCUMENT_KEYS.NY_WAGE_NOTICE,
    'NY wage notice',
    'The New York pay rate and payday notice given at hiring, signed as received.',
    'Signed wage notice.',
  ),
  signedForm(
    DOCUMENT_KEYS.DIRECT_DEPOSIT_ELECTION,
    'Direct deposit election',
    'A signed authorization to pay wages by direct deposit.',
    'Signed direct deposit election.',
  ),
  signedForm(
    DOCUMENT_KEYS.CHRC_102,
    'CHRC-102',
    'The NY DOH criminal history record check form, completed and signed.',
    'Signed CHRC-102.',
  ),
  signedForm(
    DOCUMENT_KEYS.CHRC_FINGERPRINT_QUESTIONNAIRE,
    'Fingerprint questionnaire',
    'The questionnaire that accompanies the NY DOH criminal history record check, signed.',
    'Signed fingerprint questionnaire.',
  ),
  {
    ...PERMANENT,
    key: 'CHRC',
    scope: NY,
    name: 'Criminal history record check',
    description: 'The result of the fingerprint-based NY DOH criminal history record check.',
    type: 'CHECK',
    acceptedEvidence: [option('CHECK_RESULT', 'CHRC_RESULT', 'CHRC result.')],
  },
  {
    ...PERMANENT,
    key: 'HOME_CARE_REGISTRY_LOOKUP',
    scope: NY,
    name: 'Home Care Registry lookup',
    description: 'A lookup of the aide in the NY Home Care Registry.',
    type: 'CHECK',
    acceptedEvidence: [
      option('CHECK_RESULT', 'HOME_CARE_REGISTRY_RESULT', 'Home Care Registry lookup result.'),
    ],
    manualOnly: true,
    manualOnlyReason:
      'The NY Home Care Registry lookup is a staff task until an approved automated method exists.',
  },
  {
    ...PERMANENT,
    key: REFERENCE_CHECK_REQUIREMENT_KEY,
    scope: NY,
    name: 'Reference check',
    description: 'Two professional references confirm they worked with the caregiver and recommend them.',
    type: 'CHECK',
    acceptedEvidence: [
      option('CHECK_RESULT', REFERENCE_CHECK_RESULT_EVIDENCE_KEY, 'Reference check result.'),
    ],
  },
  {
    ...PERMANENT,
    key: 'AIDE_CERTIFICATION',
    scope: NY_HHA,
    name: 'Aide certification',
    description:
      'A home health aide training certificate from a recognized training program or state agency.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'HHA_CERTIFICATE', 'HHA certificate.')],
  },
  {
    ...PERMANENT,
    key: 'AIDE_CERTIFICATION',
    scope: NY_PCA,
    name: 'Aide certification',
    description:
      'A personal care aide training certificate from a recognized training program or state agency.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'PCA_CERTIFICATE', 'PCA certificate.')],
  },
  {
    ...YEARLY,
    key: 'PHYSICAL_EXAM',
    scope: NY,
    name: 'Physical exam',
    description:
      'A report of a physical examination by a licensed clinician stating fitness to perform ' +
      'home care duties.',
    type: 'DOCUMENT',
    acceptedEvidence: [
      option('UPLOADED_DOCUMENT', 'PHYSICAL_EXAM_REPORT', 'Physical exam report.'),
    ],
  },
  {
    ...YEARLY,
    key: 'TB_SCREENING',
    scope: NY,
    name: 'TB screening',
    description:
      'A tuberculosis screening from a licensed clinic: a PPD skin test result or a chest X-ray ' +
      'report.',
    type: 'DOCUMENT',
    acceptedEvidence: [
      option('UPLOADED_DOCUMENT', 'TB_PPD_RESULT', 'PPD skin test result.'),
      option('UPLOADED_DOCUMENT', 'TB_CHEST_XRAY', 'Chest X-ray report.'),
    ],
  },
  {
    ...PERMANENT,
    key: 'IMMUNIZATION_RECORD',
    scope: NY,
    name: 'Immunization record',
    description: 'A record of immunizations from a licensed clinician or clinic.',
    type: 'DOCUMENT',
    acceptedEvidence: [
      option('UPLOADED_DOCUMENT', 'IMMUNIZATION_RECORD', 'Immunization record.'),
    ],
  },
  {
    ...PERMANENT,
    key: 'HEPATITIS_B_VACCINATION',
    scope: NY,
    name: 'Hepatitis B vaccination',
    description: 'A signed consent to, or declination of, the hepatitis B vaccine.',
    type: 'FORM',
    acceptedEvidence: [
      option(
        'SIGNED_DOCUMENT',
        DOCUMENT_KEYS.HEPATITIS_B_CONSENT_OR_DECLINATION,
        'Signed hepatitis B consent or declination.',
      ),
    ],
  },
  {
    ...YEARLY,
    key: 'FLU_VACCINATION',
    scope: NY,
    name: 'Flu vaccination',
    description: 'A signed statement for the flu season: vaccinated, or declined with a reason.',
    type: 'FORM',
    acceptedEvidence: [
      option(
        'SIGNED_DOCUMENT',
        DOCUMENT_KEYS.FLU_VACCINATION_STATEMENT,
        'Signed flu vaccination statement.',
      ),
    ],
  },
  {
    ...PERMANENT,
    key: 'ORIENTATION',
    scope: NY,
    name: 'Orientation',
    description: 'Completion of the agency orientation before the first assignment.',
    type: 'TRAINING',
    acceptedEvidence: [option('TRAINING_RECORD', 'ORIENTATION_RECORD', 'Orientation record.')],
  },
  // A new hire cannot yet have this year's in-service hours, and PRD § 6 asks to flag a shortfall,
  // not to block. The minimums are defaults awaiting confirmation (T-033 Risk 4), not quoted
  // regulation.
  {
    ...PERMANENT,
    key: 'IN_SERVICE_TRAINING',
    scope: NY_HHA,
    name: 'Annual in-service training',
    description: 'The annual in-service training hours a home health aide must complete.',
    type: 'TRAINING',
    acceptedEvidence: [
      option('TRAINING_RECORD', 'IN_SERVICE_HOURS', 'In-service training hours.'),
    ],
    renewalRule: 'ANNUAL',
    blocksClearance: false,
    minimumMinutes: 720,
  },
  {
    ...PERMANENT,
    key: 'IN_SERVICE_TRAINING',
    scope: NY_PCA,
    name: 'Annual in-service training',
    description: 'The annual in-service training hours a personal care aide must complete.',
    type: 'TRAINING',
    acceptedEvidence: [
      option('TRAINING_RECORD', 'IN_SERVICE_HOURS', 'In-service training hours.'),
    ],
    renewalRule: 'ANNUAL',
    blocksClearance: false,
    minimumMinutes: 360,
  },
]

// Rules the agency chooses rather than the state imposes, copied into one agency. The PHI
// acknowledgement, emergency contacts and EEO form are NY-scoped so the DEMO set stays at seven
// (ADR-166); the disclosure and background check are agency-wide. No key here is also a platform key: a bare {agencyId} scope and a {state} scope are incomparable,
// so an overlap would make resolution ambiguous.
const NY_AGENCY_DEFAULT_TEMPLATES: readonly PublishRequirementTemplateInput[] = [
  // SECURITY.md: the PHI acknowledgement workflow is an agency-configured requirement.
  {
    ...PERMANENT,
    key: DOCUMENT_KEYS.PHI_ACKNOWLEDGEMENT,
    scope: NY,
    name: 'PHI acknowledgement',
    description: 'A signed acknowledgement of the agency policy on protected health information.',
    type: 'ATTESTATION',
    acceptedEvidence: [
      option('SIGNED_DOCUMENT', DOCUMENT_KEYS.PHI_ACKNOWLEDGEMENT, 'Signed PHI acknowledgement.'),
    ],
  },
  // OPEN-QUESTIONS 42: an always-asked section is an agency-wide FORM template.
  intake(
    INTAKE_REQUIREMENT_KEYS.EMERGENCY_CONTACTS,
    NY,
    'Emergency contacts',
    'People to contact in an emergency, with their relationship and phone number.',
  ),
  {
    ...intake(
      INTAKE_REQUIREMENT_KEYS.EEOC_SELF_IDENTIFICATION,
      NY,
      'EEO self-identification',
      'Voluntary self-identification of race, ethnicity, sex, veteran and disability status.',
    ),
    // The form is voluntary, so an unanswered one cannot hold up clearance.
    blocksClearance: false,
  },
  {
    ...PERMANENT,
    key: DOCUMENT_KEYS.FCRA_DISCLOSURE,
    scope: AGENCY_WIDE,
    name: 'Background check disclosure',
    description: 'A signed standalone disclosure and authorization for a consumer background check.',
    type: 'ATTESTATION',
    acceptedEvidence: [
      option(
        'SIGNED_DOCUMENT',
        DOCUMENT_KEYS.FCRA_DISCLOSURE,
        'Signed background check disclosure and authorization.',
      ),
    ],
  },
  {
    ...PERMANENT,
    key: 'BACKGROUND_CHECK',
    scope: AGENCY_WIDE,
    name: 'Background check',
    description: 'The result of a third-party consumer background check.',
    type: 'CHECK',
    acceptedEvidence: [
      option('CHECK_RESULT', 'BACKGROUND_CHECK_RESULT', 'Background check result.'),
    ],
  },
]

export async function publishAll(
  db: CorePrismaClient,
  agencyId: string | null,
  templates: readonly PublishRequirementTemplateInput[],
  now: Date,
): Promise<number> {
  let published = 0
  for (const input of templates) {
    // One transaction per template keeps each publish atomic and far below Prisma's interactive
    // transaction timeout; idempotency makes a re-run converge after a partial failure.
    const changed = await db.$transaction((tx) =>
      publishRequirementTemplateIfChanged(tx, agencyId, input, now),
    )
    if (changed) published += 1
  }
  return published
}

// `agencyId = null` is the seeder-only platform write ADR-014 permits. A rule removed from the
// library is withdrawn here (ADR-149).
export async function seedNyPlatformRequirementTemplates(
  db: CorePrismaClient,
  now: Date,
): Promise<number> {
  const published = await publishAll(db, null, NY_PLATFORM_TEMPLATES, now)
  await db.$transaction((tx) => retirePlatformTemplatesNotIn(tx, 'NY', NY_PLATFORM_TEMPLATES, now))
  return published
}

export function seedNyAgencyRequirementTemplates(
  db: CorePrismaClient,
  agencyId: string,
  now: Date,
): Promise<number> {
  return publishAll(db, agencyId, NY_AGENCY_DEFAULT_TEMPLATES, now)
}
