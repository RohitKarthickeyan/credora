import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ACCEPTED_ISSUER_KIND_LABELS } from '@/app/_lib/accepted-issuer-kind'
import type { AcceptedIssuer } from '@/domain/documents/accepted-issuer'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listAcceptedIssuers } from '@/server/review/accepted-issuers'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'
import { SubmitButton } from '@/ui/submit-button'
import { addIssuer, retireIssuer } from './actions'
import { IssuerForm } from './issuer-form'

const COLUMNS: ReadonlyArray<Column<AcceptedIssuer>> = [
  { key: 'name', header: 'Name', cell: (issuer) => issuer.name },
  { key: 'kind', header: 'Kind', cell: (issuer) => ACCEPTED_ISSUER_KIND_LABELS[issuer.kind] },
  {
    key: 'actions',
    header: 'Actions',
    align: 'end',
    cell: (issuer) => (
      <div className="flex items-center justify-end gap-3">
        <Link href={`/admin/issuers/${issuer.id}`} className="text-sm font-medium underline">
          Edit
        </Link>
        <form action={retireIssuer.bind(null, issuer.id)}>
          <SubmitButton variant="ghost" size="sm" pendingLabel="Retiring…">
            Retire
          </SubmitButton>
        </form>
      </div>
    ),
  },
]

export default async function AcceptedIssuersPage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a coordinator is not told the page exists.
  if (!can(principal, 'issuerAllowlist.manage')) notFound()

  const issuers = await runAsPrincipal(principal, {}, () => listAcceptedIssuers({}))

  return (
    <>
      <PageHeader
        title="Accepted issuers"
        description="Documents from a listed issuer are not sent to the judge for an issuer check."
      />
      <div className="flex flex-col gap-8">
        <IssuerForm action={addIssuer} submitLabel="Add issuer" />
        <DataTable
          caption="Accepted issuers"
          columns={COLUMNS}
          rows={issuers}
          getRowKey={(issuer) => issuer.id}
          empty={
            <EmptyState
              title="No accepted issuers yet"
              description="Every document's issuer goes to the judge until one is added."
            />
          }
        />
      </div>
    </>
  )
}
