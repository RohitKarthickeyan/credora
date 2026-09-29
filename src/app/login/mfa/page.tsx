import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getStaffMfaChallenge } from '@/server/auth/session'
import { PageHeader } from '@/ui/page-header'
import { SecondFactorForm } from './second-factor-form'

export const metadata: Metadata = { title: 'Enter your code' }

export default async function SecondFactorPage() {
  const challenge = await getStaffMfaChallenge()
  if (challenge === null) redirect('/login')
  if (challenge.step === 'ENROL') redirect('/login/mfa/setup')

  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader
        title="Two-step sign-in"
        description="Enter the 6-digit code from your authenticator app."
      />
      <SecondFactorForm />
      <Link
        href="/login"
        className="mt-4 inline-flex min-h-touch items-center text-sm font-medium text-brand-700"
      >
        Sign in again
      </Link>
    </main>
  )
}
