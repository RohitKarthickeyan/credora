import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getStaffSession } from '@/server/auth/session'
import { PageHeader } from '@/ui/page-header'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage() {
  if ((await getStaffSession()) !== null) redirect('/')

  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader title="Sign in" />
      <SignInForm />
    </main>
  )
}
