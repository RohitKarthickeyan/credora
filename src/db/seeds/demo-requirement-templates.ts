import type { ResolutionContext } from '@/domain/requirements/resolve'
import { DOCUMENT_KEYS, INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { CorePrismaClient } from '../prisma'
import type { PublishRequirementTemplateInput } from '../repositories/requirement-templates'
import { retirePlatformTemplatesNotIn } from '../repositories/requirement-template-writer'
import { option, PERMANENT, publishAll, YEARLY } from './ny-requirement-templates'

// The small set the text-onboarding demo resolves for work state DEMO (ADR-166). Seven
// requirements in all: these five plus the agency-wide disclosure and background check.
const DEMO: ResolutionContext = { state: 'DEMO' }

const DEMO_PLATFORM_TEMPLATES: readonly PublishRequirementTemplateInput[] = [
  {
    ...PERMANENT,
    key: INTAKE_REQUIREMENT_KEYS.TEXT,
    scope: DEMO,
    name: 'Intake by text',
    description: 'Legal name, date of birth, sex, email, home address and SSN, confirmed by text.',
    type: 'FORM',
    acceptedEvidence: [
      option('ATTESTATION', `${INTAKE_REQUIREMENT_KEYS.TEXT}_SUBMITTED`, 'I confirm my details are correct.'),
    ],
  },
  {
    ...PERMANENT,
    key: DOCUMENT_KEYS.DEMO_INTAKE_FORM,
    scope: DEMO,
    name: 'Intake form',
    description: 'The signed caregiver intake form.',
    type: 'FORM',
    acceptedEvidence: [option('SIGNED_DOCUMENT', DOCUMENT_KEYS.DEMO_INTAKE_FORM, 'Signed intake form.')],
  },
  {
    ...PERMANENT,
    key: 'AIDE_CERTIFICATION',
    scope: DEMO,
    name: 'HHA certificate',
    description: 'A home health aide training certificate from a recognized training program or state agency.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'HHA_CERTIFICATE', 'HHA certificate.')],
  },
  {
    ...YEARLY,
    key: 'TB_TEST',
    scope: DEMO,
    name: 'TB test',
    description: 'A tuberculosis PPD skin test result from a licensed clinic.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'TB_PPD_RESULT', 'PPD skin test result.')],
  },
  {
    key: 'PHOTO_ID',
    scope: DEMO,
    validityRule: 'FROM_EVIDENCE',
    validityMonths: null,
    renewalRule: 'NONE',
    manualOnlyReason: null,
    name: "Driver's license",
    description: "A current driver's license issued by a US state motor vehicle agency.",
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'DRIVERS_LICENSE', "Driver's license.")],
  },
]

export async function seedDemoPlatformRequirementTemplates(
  db: CorePrismaClient,
  now: Date,
): Promise<number> {
  const published = await publishAll(db, null, DEMO_PLATFORM_TEMPLATES, now)
  await db.$transaction((tx) =>
    retirePlatformTemplatesNotIn(tx, 'DEMO', DEMO_PLATFORM_TEMPLATES, now),
  )
  return published
}
