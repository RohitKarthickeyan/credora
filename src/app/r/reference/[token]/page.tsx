import type { Metadata } from 'next'
import type { LinkRefusal } from '@/domain/auth/link-token'
import { viewReferenceForm } from '@/server/verification/references'
import { PageHeader } from '@/ui/page-header'
import { ReferenceForm } from './reference-form'

export const metadata: Metadata = { title: 'Reference request' }

const REFUSALS: Record<LinkRefusal, string> = {
  INVALID: "This link isn't valid.",
  EXPIRED: 'This link has expired. If you were sent a newer one, please use that.',
  USED: 'This reference has already been answered. Thank you.',
}

const MAIN_CLASS = 'mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4'

// The GET does not consume the token: message scanners prefetch links. Submitting the answers does.
// A reference has no account, so there is no sign-in link.
export default async function ReferenceFormPage({ params }: PageProps<'/r/reference/[token]'>) {
  const { token } = await params
  const view = await viewReferenceForm(token, {})

  if (!view.ok || view.value === null || !view.value.open) {
    return (
      <main id="main" className={MAIN_CLASS}>
        <PageHeader title={view.ok ? 'This request is no longer active.' : REFUSALS[view.refusal]} />
      </main>
    )
  }

  const { agencyName, caregiverName } = view.value
  return (
    <main id="main" className={MAIN_CLASS}>
      <PageHeader
        title={`Reference for ${caregiverName ?? 'a caregiver'}`}
        description={`${agencyName} asked for your reference. It takes about a minute.`}
      />
      <ReferenceForm token={token} agencyName={agencyName} />
    </main>
  )
}
