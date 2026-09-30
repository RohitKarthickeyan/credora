import Link from 'next/link'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
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
        className="flex flex-col gap-4 border-b border-border-strong px-4 py-4 lg:w-64 lg:border-b-0 lg:border-r"
      >
        <Link href="/" className="text-lg font-semibold text-ink">
          Credora
        </Link>
        {can(principal, 'pipeline.view') ? (
          <Link href="/pipeline" className="text-sm font-medium text-ink">
            Pipeline
          </Link>
        ) : null}
        {can(principal, 'conversation.manage') ? <Link href="/conversations" className="text-sm font-medium text-ink">Conversations</Link> : null}
        {can(principal, 'exceptionQueue.view') ? <Link href="/queue" className="text-sm font-medium text-ink">Exceptions</Link> : null}
        {can(principal, 'manualCheck.list') ? <Link href="/checks" className="text-sm font-medium text-ink">Staff checks</Link> : null}
        {can(principal, 'clearance.view') ? <Link href="/clearance" className="text-sm font-medium text-ink">Clearance</Link> : null}
        {can(principal, 'alayaCareSync.view') ? <Link href="/sync" className="text-sm font-medium text-ink">AlayaCare conflicts</Link> : null}
        {can(principal, 'training.view') ? <Link href="/training" className="text-sm font-medium text-ink">Training</Link> : null}
        {can(principal, 'weeklySample.view') ? <Link href="/sample" className="text-sm font-medium text-ink">Weekly sample</Link> : null}
        {can(principal, 'user.manage') ? <Link href="/admin/users" className="text-sm font-medium text-ink">Users</Link> : null}
        {can(principal, 'requirementTemplate.manage') ? <Link href="/admin/requirements" className="text-sm font-medium text-ink">Requirements</Link> : null}
        {can(principal, 'eeocReport.view') ? <Link href="/reports/eeoc" prefetch={false} className="text-sm font-medium text-ink">EEOC report</Link> : null}
        {can(principal, 'successMetrics.view') ? <Link href="/reports/metrics" className="text-sm font-medium text-ink">Success metrics</Link> : null}
        <p className="text-sm text-ink-muted">Signed in as {fullName}</p>
        <form action={signOut}>
          <SubmitButton variant="secondary">Sign out</SubmitButton>
        </form>
      </nav>
      <main id="main" className="min-w-0 flex-1 px-4 lg:px-8">
        {children}
      </main>
    </div>
  )
}
