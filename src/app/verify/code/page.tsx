import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/ui/page-header'
import { CodeForm } from './code-form'

export const metadata: Metadata = { title: 'Enter your code' }

export default function VerifyCodePage() {
  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <PageHeader
        title="Enter your code"
        description="If that address belongs to a caregiver onboarding with an agency, we've emailed a code. It expires in 10 minutes."
      />
      <CodeForm />
      <Link
        href="/verify"
        className="mt-4 inline-flex min-h-touch items-center text-sm font-medium text-brand-700"
      >
        Send a new code
      </Link>
    </main>
  )
}
