import type { Metadata } from 'next'
import { PageHeader } from '@/ui/page-header'
import { EmailForm } from './email-form'

export const metadata: Metadata = { title: 'Sign in' }

export default function VerifyPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader
        title="Sign in"
        description="Enter the email address your agency has for you. We'll email you a code."
      />
      <EmailForm />
    </main>
  )
}
