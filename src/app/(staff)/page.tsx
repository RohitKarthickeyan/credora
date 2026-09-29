import { requireStaffSession } from '@/server/auth/session'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'

export default async function StaffHomePage() {
  const { fullName } = await requireStaffSession()

  return (
    <>
      <PageHeader title={`Welcome, ${fullName}`} />
      <EmptyState
        title="Nothing to work on yet"
        description="Caregivers in onboarding will appear here."
      />
    </>
  )
}
