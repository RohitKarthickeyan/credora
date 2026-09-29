import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { PageHeader } from '@/ui/page-header'
import { InviteForm } from './invite-form'

export const metadata: Metadata = { title: 'Invite a caregiver' }

export default async function InviteCaregiverPage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a supervisor is not told the page exists.
  if (!can(principal, 'caregiver.invite')) notFound()

  return (
    <>
      <PageHeader
        title="Invite a caregiver"
        description="Record an accepted offer. The caregiver is emailed a link to start their onboarding paperwork."
        back={{ href: '/pipeline', label: 'Pipeline' }}
      />
      <InviteForm />
    </>
  )
}
