import { notFound } from 'next/navigation'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listAcceptedIssuers } from '@/server/review/accepted-issuers'
import { PageHeader } from '@/ui/page-header'
import { updateIssuer } from '../actions'
import { IssuerForm } from '../issuer-form'

export default async function EditAcceptedIssuerPage(props: PageProps<'/admin/issuers/[id]'>) {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'issuerAllowlist.manage')) notFound()

  const { id } = await props.params
  const issuers = await runAsPrincipal(principal, {}, () => listAcceptedIssuers({}))
  const issuer = issuers.find((candidate) => candidate.id === id)
  if (issuer === undefined) notFound()

  return (
    <>
      <PageHeader
        title="Edit accepted issuer"
        back={{ href: '/admin/issuers', label: 'Accepted issuers' }}
      />
      <IssuerForm
        action={updateIssuer.bind(null, id)}
        defaults={{ name: issuer.name, kind: issuer.kind }}
        submitLabel="Save changes"
      />
    </>
  )
}
