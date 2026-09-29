import { notFound } from 'next/navigation'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { listRequirementTemplates } from '@/server/requirements/template-admin'
import { PageHeader } from '@/ui/page-header'
import { overrideTemplate } from '../../actions'
import { scopeLabel } from '../../scope-label'
import { type ScopePicker, TemplateForm } from '../../template-form'
import { toFormValues } from '../../template-form-data'

const AXES: readonly ScopePicker[] = ['state', 'serviceType', 'role', 'payer']

export default async function OverrideRequirementTemplatePage(
  props: PageProps<'/admin/requirements/[id]/override'>,
) {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'requirementTemplate.manage')) notFound()

  const { id } = await props.params
  const templates = await runAsPrincipal(principal, {}, () => listRequirementTemplates({}))
  const base = templates.find((candidate) => candidate.id === id)
  if (base === undefined || (base.scope.agencyId ?? null) !== null) notFound()

  return (
    <>
      <PageHeader
        title={`Override ${base.key}`}
        description="Your agency's version of this New York rule. It keeps every scope the rule sets, and you may narrow it further."
        back={{ href: '/admin/requirements', label: 'Requirements' }}
      />
      <TemplateForm
        action={overrideTemplate.bind(null, id)}
        defaults={toFormValues(base)}
        submitLabel="Publish override"
        showKey={false}
        fixedScope={`${scopeLabel(base.scope)} · your agency`}
        scopePickers={AXES.filter((axis) => (base.scope[axis] ?? null) === null)}
      />
    </>
  )
}
