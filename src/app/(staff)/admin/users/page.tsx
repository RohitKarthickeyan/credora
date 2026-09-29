import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { STAFF_ROLE_LABELS } from '@/app/_lib/staff-role'
import type { StaffUser } from '@/domain/auth/staff-user'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listStaffUsers } from '@/server/users/staff-users'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { InviteStaffForm } from './invite-staff-form'
import { StaffUserControls } from './staff-user-controls'

export const metadata: Metadata = { title: 'Users' }

function statusOf(user: StaffUser): string {
  if (!user.isActive) return 'Deactivated'
  return user.invitePending ? 'Invite sent' : 'Active'
}

const COLUMNS: ReadonlyArray<Column<StaffUser>> = [
  { key: 'name', header: 'Name', cell: (user) => user.fullName },
  { key: 'email', header: 'Email', cell: (user) => user.email },
  { key: 'role', header: 'Role', cell: (user) => STAFF_ROLE_LABELS[user.role] },
  { key: 'status', header: 'Status', cell: statusOf },
  {
    key: 'actions',
    header: 'Actions',
    align: 'end',
    cell: (user) => <StaffUserControls user={user} />,
  },
]

export default async function UsersPage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a coordinator is not told the page exists.
  if (!can(principal, 'user.manage')) notFound()

  const users = await runAsPrincipal(principal, {}, () => listStaffUsers({}))

  return (
    <>
      <PageHeader
        title="Users"
        description="Invite staff, set their role, and deactivate anyone who should no longer sign in."
      />
      <div className="flex flex-col gap-8">
        <InviteStaffForm />
        <DataTable caption="Staff" columns={COLUMNS} rows={users} getRowKey={(user) => user.id} />
      </div>
    </>
  )
}
