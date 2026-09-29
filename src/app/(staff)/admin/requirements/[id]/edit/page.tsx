import { notFound } from 'next/navigation'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listRequirementTemplates } from '@/server/requirements/template-admin'
import { PageHeader } from '@/ui/page-header'
import { editTemplate } from '../../actions'
import { scopeLabel } from '../../scope-label'
import { TemplateForm } from '../../template-form'
import { toFormValues } from '../../template-form-data'

export default async function EditRequirementTemplatePage(
  props: PageProps<'/admin/requirements/[id]/edit'>,
) {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'requirementTemplate.manage')) notFound()

  const { id } = await props.params
  const templates = await runAsPrincipal(principal, {}, () => listRequirementTemplates({}))
  const template = templates.find((candidate) => candidate.id === id)
  if (template === undefined || (template.scope.agencyId ?? null) === null) notFound()

  return (
    <>
      <PageHeader
        title={`Edit ${template.key}`}
        back={{ href: '/admin/requirements', label: 'Requirements' }}
      />
      <TemplateForm
        action={editTemplate.bind(null, id)}
        defaults={toFormValues(template)}
        submitLabel="Publish new version"
        showKey={false}
        fixedScope={scopeLabel(template.scope)}
        scopePickers={[]}
      />
    </>
  )
}
