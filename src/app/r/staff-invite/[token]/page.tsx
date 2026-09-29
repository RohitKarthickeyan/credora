import type { Metadata } from 'next'
import Link from 'next/link'
import type { LinkRefusal } from '@/domain/auth/link-token'
import { viewStaffInvite } from '@/server/users/staff-invite-link'
import { PageHeader } from '@/ui/page-header'
import { SetPasswordForm } from './set-password-form'

export const metadata: Metadata = { title: 'Set up your account' }

const REFUSALS: Record<LinkRefusal, string> = {
  INVALID: "This link isn't valid.",
  EXPIRED: 'This invite link has expired. Ask your agency admin to resend it.',
  USED: 'This invite link has already been used.',
}

const MAIN_CLASS = 'mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4'

// The GET does not consume the token: mail scanners prefetch links. Setting the password does.
export default async function StaffInvitePage({ params }: PageProps<'/r/staff-invite/[token]'>) {
  const { token } = await params
  const invite = await viewStaffInvite(token, {})

  if (!invite.ok || invite.value === null) {
    return (
      <main id="main" className={MAIN_CLASS}>
        <PageHeader
          title={invite.ok ? 'This invite is no longer active.' : REFUSALS[invite.refusal]}
        />
        <Link href="/login" className="text-sm font-medium underline">
          Go to sign in
        </Link>
      </main>
    )
  }

  return (
    <main id="main" className={MAIN_CLASS}>
      <PageHeader
        title="Set up your account"
        description={`${invite.value.agencyName} added you to Credora as ${invite.value.email}.`}
      />
      <SetPasswordForm token={token} email={invite.value.email} />
    </main>
  )
}
