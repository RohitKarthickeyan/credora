import type { Metadata } from 'next'
import Link from 'next/link'
import type { LinkRefusal } from '@/domain/auth/link-token'
import { getCaregiverSession } from '@/server/auth/caregiver-session'
import { viewInvite } from '@/server/caregivers/invite-link'
import { PageHeader } from '@/ui/page-header'
import { StartForm } from './start-form'

export const metadata: Metadata = { title: 'Your invite' }

const REFUSALS: Record<LinkRefusal, string> = {
  INVALID: "This link isn't valid.",
  EXPIRED: 'This invite link has expired.',
  USED: 'This invite link has already been used.',
}

const LINK_CLASS =
  'inline-flex min-h-touch w-full items-center justify-center rounded-control bg-brand-600 px-4 text-field font-medium text-ink-inverse hover:bg-brand-700'

// The GET does not consume the token: mail clients prefetch links. The button does.
export default async function InvitePage({ params }: PageProps<'/r/invite/[token]'>) {
  const { token } = await params
  const invite = await viewInvite(token, {})

  if (!invite.ok) {
    return (
      <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
        <PageHeader title={REFUSALS[invite.refusal]} />
        <Link href="/verify" className={LINK_CLASS}>
          Sign in with your email
        </Link>
      </main>
    )
  }

  const session = await getCaregiverSession()
  const signedIn = session?.caregiverId === invite.value.caregiverId

  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader
        title="Welcome"
        description={`${invite.value.agencyName} invited you to complete your onboarding paperwork.`}
      />
      {signedIn ? (
        <StartForm token={token} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-ink">First, confirm your email address. We&apos;ll email you a code.</p>
          <Link href="/verify" className={LINK_CLASS}>
            Continue
          </Link>
        </div>
      )}
    </main>
  )
}
