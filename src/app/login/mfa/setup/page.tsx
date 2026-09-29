import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getStaffMfaChallenge, getStaffSession } from '@/server/auth/session'
import { PageHeader } from '@/ui/page-header'
import { EnrolmentForm } from './enrolment-form'

export const metadata: Metadata = { title: 'Set up two-step sign-in' }

function Page({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader
        title="Set up two-step sign-in"
        description="Your agency requires a code from an authenticator app each time you sign in."
      />
      {children}
    </main>
  )
}

export default async function EnrolmentPage() {
  // Confirming sets the session cookie inside the action, and Next re-renders this page in the
  // same response. The signed-in branch must render the same form in the same place, or the
  // recovery codes held in its client state would be lost before anyone saw them.
  if ((await getStaffSession()) !== null) {
    return (
      <Page>
        <EnrolmentForm enrolment={null} />
      </Page>
    )
  }

  const challenge = await getStaffMfaChallenge()
  if (challenge === null) redirect('/login')
  if (challenge.step === 'VERIFY') redirect('/login/mfa')

  return (
    <Page>
      <EnrolmentForm enrolment={{ secret: challenge.secret, otpauthUri: challenge.otpauthUri }} />
    </Page>
  )
}
