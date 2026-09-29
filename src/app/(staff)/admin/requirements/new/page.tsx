import { notFound } from 'next/navigation'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { PageHeader } from '@/ui/page-header'
import { addTemplate } from '../actions'
import { TemplateForm } from '../template-form'

export default async function NewRequirementTemplatePage() {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'requirementTemplate.manage')) notFound()

  return (
    <>
      <PageHeader
        title="Add a requirement"
        description="A requirement of your agency's own, for the caregivers you choose below."
        back={{ href: '/admin/requirements', label: 'Requirements' }}
      />
      <TemplateForm
        action={addTemplate}
        defaults={{ blocksClearance: 'on' }}
        submitLabel="Publish"
        showKey
        scopePickers={['state', 'serviceType', 'role', 'payer']}
      />
    </>
  )
}
