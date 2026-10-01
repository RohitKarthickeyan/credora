import Link from 'next/link'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { NavLink } from '@/ui/nav-link'
import { SubmitButton } from '@/ui/submit-button'
import { signOut } from '../login/actions'

// This renders the nav only. A layout does not re-render on client navigation, so each page
// under it calls requireStaffSession itself; that call is the gate.
export default async function StaffLayout({ children }: LayoutProps<'/'>) {
  const { principal, fullName } = await requireStaffSession()

  return (
    <div className="lg:flex">
      <nav
        aria-label="Staff"
        className="flex flex-col gap-1 border-b border-border-strong px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        <Link href="/" className="mb-3 px-3 text-lg font-semibold text-ink">
          Credora
        </Link>
        {can(principal, 'pipeline.view') ? <NavLink href="/pipeline">Pipeline</NavLink> : null}
        {can(principal, 'exceptionQueue.view') ? <NavLink href="/queue">Exceptions</NavLink> : null}
        {can(principal, 'manualCheck.list') ? <NavLink href="/checks">Staff checks</NavLink> : null}
        {can(principal, 'alayaCareSync.view') ? <NavLink href="/sync">AlayaCare conflicts</NavLink> : null}
        {can(principal, 'training.view') ? <NavLink href="/training">Training</NavLink> : null}
        {can(principal, 'weeklySample.view') ? <NavLink href="/sample">Weekly sample</NavLink> : null}
        {can(principal, 'user.manage') ? <NavLink href="/admin/users">Users</NavLink> : null}
        {can(principal, 'requirementTemplate.manage') ? <NavLink href="/admin/requirements">Requirements</NavLink> : null}
        {can(principal, 'eeocReport.view') ? <NavLink href="/reports/eeoc" prefetch={false}>EEOC report</NavLink> : null}
        {can(principal, 'successMetrics.view') ? <NavLink href="/reports/metrics">Success metrics</NavLink> : null}
        <p className="mt-4 px-3 text-sm text-ink-muted">Signed in as {fullName}</p>
        <form action={signOut} className="px-3">
          <SubmitButton variant="secondary">Sign out</SubmitButton>
        </form>
      </nav>
      <main id="main" className="min-w-0 flex-1 px-4 lg:px-8">
        {children}
      </main>
    </div>
  )
}
