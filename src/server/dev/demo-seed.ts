import 'server-only'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { findCaregiverForSession } from '@/db/repositories/caregiver-sign-in'
import { hasCaregiverWithEmail } from '@/db/repositories/invites'
import { findUserForSession } from '@/db/repositories/users'
import { caregiverPrincipalFrom } from '@/domain/auth/caregiver-principal'
import { staffPrincipalFrom } from '@/domain/auth/staff-principal'
import { IDENTITY_SECTION } from '@/domain/forms/sections/identity'
import type { PipelineStage } from '@/domain/pipeline/stage'
import type { StoragePort } from '@/integrations/ports/storage'
import { runAsPrincipal } from '@/server/auth/context'
import { inviteCaregiver } from '@/server/caregivers/invite'
import { uploadOwnDocument, viewOwnDocumentRequests } from '@/server/documents/uploads'
import { saveIntakeStep } from '@/server/intake/flow'

type DemoUpload = { readonly templateKey: string; readonly evidenceKey: string; readonly fixture: string }

type DemoCaregiver = {
  readonly key: string
  readonly invite: {
    readonly legalFirstName: string
    readonly legalLastName: string
    readonly email: string
    readonly serviceType: 'HHA' | 'PCA'
  }
  readonly identity: { readonly legalMiddleName: string; readonly dateOfBirth: string; readonly ssn: string } | null
  readonly uploads: readonly DemoUpload[]
}

// Nobody goes past INTAKE: no later stage's entering use case is called here yet (ADR-086).
// The addresses are at the reserved example.com domain. Maria is the extraction fixtures' identity.
const DEMO_CAREGIVERS = [
  {
    key: 'MARIA_SANTOS',
    invite: { legalFirstName: 'Maria', legalLastName: 'Santos', email: 'maria.santos@example.com', serviceType: 'HHA' },
    identity: { legalMiddleName: 'Elena', dateOfBirth: '1988-03-14', ssn: '123-45-6789' },
    uploads: [
      { templateKey: 'AIDE_CERTIFICATION', evidenceKey: 'HHA_CERTIFICATE', fixture: 'hha-certificate.pdf' },
      { templateKey: 'TB_SCREENING', evidenceKey: 'TB_PPD_RESULT', fixture: 'ppd-tb-result.pdf' },
    ],
  },
  {
    key: 'GRACE_MENSAH',
    invite: { legalFirstName: 'Grace', legalLastName: 'Mensah', email: 'grace.mensah@example.com', serviceType: 'HHA' },
    identity: { legalMiddleName: '', dateOfBirth: '1991-07-22', ssn: '234-56-7890' },
    uploads: [],
  },
  {
    key: 'ANDRE_JOSEPH',
    invite: { legalFirstName: 'Andre', legalLastName: 'Joseph', email: 'andre.joseph@example.com', serviceType: 'PCA' },
    identity: null,
    uploads: [],
  },
] as const satisfies readonly DemoCaregiver[]

type DemoCaregiverKey = (typeof DEMO_CAREGIVERS)[number]['key']

type DemoCaregiverOutcome =
  | { readonly key: DemoCaregiverKey; readonly outcome: 'CREATED'; readonly caregiverId: string; readonly stage: PipelineStage }
  | { readonly key: DemoCaregiverKey; readonly outcome: 'SKIPPED' }

function fixtureBytes(name: string): Promise<Buffer> {
  return readFile(fileURLToPath(new URL(`../../integrations/adapters/extraction/fixtures/${name}`, import.meta.url)))
}

async function actAsCaregiver(
  agencyId: string,
  caregiverId: string,
  demo: DemoCaregiver,
  storage: StoragePort,
): Promise<PipelineStage> {
  const row = await findCaregiverForSession(agencyId, caregiverId)
  const principal = row === null ? null : caregiverPrincipalFrom(row)
  if (principal === null) throw new Error(`Demo caregiver ${demo.key} cannot sign in.`)

  return runAsPrincipal(principal, {}, async () => {
    if (demo.identity !== null) {
      const answers = {
        legalFirstName: demo.invite.legalFirstName,
        legalMiddleName: demo.identity.legalMiddleName,
        legalLastName: demo.invite.legalLastName,
        nameSuffix: '',
        otherNames: '',
        dateOfBirth: demo.identity.dateOfBirth,
        ssn: demo.identity.ssn,
        sex: 'F',
        maritalStatus: '',
        countryOfBirth: 'United States',
      }
      const saved = await saveIntakeStep({ caregiverId, stepId: IDENTITY_SECTION.id, answers })
      if (saved === null || !saved.saved) {
        throw new Error(`Demo caregiver ${demo.key}'s identity answers were refused: ${JSON.stringify(saved)}.`)
      }
    }

    if (demo.uploads.length > 0) {
      const requests = await viewOwnDocumentRequests({ caregiverId })
      for (const upload of demo.uploads) {
        const request = requests.find((candidate) => candidate.templateKey === upload.templateKey)
        if (request === undefined) throw new Error(`Demo caregiver ${demo.key} has no ${upload.templateKey} request.`)
        const result = await uploadOwnDocument({
          caregiverId,
          instanceId: request.instanceId,
          evidenceKey: upload.evidenceKey,
          bytes: await fixtureBytes(upload.fixture),
          storage,
        })
        if (!result.ok) throw new Error(`Demo caregiver ${demo.key}'s ${upload.fixture} was refused: ${result.refusal}.`)
      }
    }

    const after = await findCaregiverForSession(agencyId, caregiverId)
    if (after === null) throw new Error(`Demo caregiver ${demo.key} disappeared.`)
    return after.stage
  })
}

/**
 * Put the demo caregivers where they are through the product's own use cases, as the seeded
 * coordinator and then as each caregiver (ADR-086). A caregiver already on the demo email address,
 * in any stage including WITHDRAWN, is skipped whole, which is what makes a second run a no-op.
 */
export async function seedDemoCaregivers(input: {
  readonly agencyId: string
  readonly coordinatorUserId: string
  readonly storage: StoragePort
}): Promise<readonly DemoCaregiverOutcome[]> {
  const coordinator = await findUserForSession(input.agencyId, input.coordinatorUserId)
  const staff = coordinator === null ? null : staffPrincipalFrom(coordinator)
  if (staff === null) throw new Error(`Coordinator ${input.coordinatorUserId} cannot act for the agency.`)

  const outcomes: DemoCaregiverOutcome[] = []
  for (const demo of DEMO_CAREGIVERS) {
    if (await hasCaregiverWithEmail(input.agencyId, demo.invite.email)) {
      outcomes.push({ key: demo.key, outcome: 'SKIPPED' })
      continue
    }
    const invited = await runAsPrincipal(staff, {}, () =>
      inviteCaregiver({ ...demo.invite, workState: 'NY', payer: 'PRIVATE_PAY' }),
    )
    if (!invited.ok && invited.reason === 'EMAIL_IN_USE') {
      outcomes.push({ key: demo.key, outcome: 'SKIPPED' })
      continue
    }
    if (!invited.ok) {
      throw new Error(`Demo caregiver ${demo.key}'s requirements are ambiguous: ${invited.keys.join(', ')}.`)
    }

    const stage = await actAsCaregiver(input.agencyId, invited.caregiverId, demo, input.storage)
    outcomes.push({ key: demo.key, outcome: 'CREATED', caregiverId: invited.caregiverId, stage })
  }
  return outcomes
}
