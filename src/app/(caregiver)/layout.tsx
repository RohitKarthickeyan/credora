import Link from 'next/link'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { SubmitButton } from '@/ui/submit-button'
import { signOut } from '../verify/actions'

const NAV = [
  { href: '/intake', label: 'Questions' },
  { href: '/sign', label: 'Sign' },
  { href: '/documents', label: 'Documents' },
  { href: '/record', label: 'Your record' },
] as const

// A layout does not re-render on client navigation, so each page and action under it calls
// requireCaregiverSession itself; that call is the gate.
export default async function CaregiverLayout({ children }: LayoutProps<'/'>) {
  await requireCaregiverSession()

  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 pb-24 pt-4">
      <nav aria-label="Your onboarding" className="mb-4">
        <ul className="flex flex-wrap gap-x-4">
          {NAV.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="inline-flex min-h-touch items-center font-medium text-brand-700">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
      <form action={signOut} className="mt-8">
        <SubmitButton variant="secondary">Sign out</SubmitButton>
      </form>
    </main>
  )
}
