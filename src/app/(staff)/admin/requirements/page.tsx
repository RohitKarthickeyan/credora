import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { RequirementLayer } from '@/domain/requirements/scope'
import { LAYER_PRECEDENCE } from '@/domain/requirements/scope'
import type { RequirementTemplate } from '@/domain/requirements/template'
import { scopeChoiceSchema } from '@/domain/requirements/template-admin'
import { CAREGIVER_ROLES, PAYERS, SERVICE_TYPES, STATES } from '@/domain/requirements/vocabulary'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import {
  listRequirementTemplates,
  previewRequirementResolution,
} from '@/server/requirements/template-admin'
import { Alert } from '@/ui/alert'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { PageHeader } from '@/ui/page-header'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { retireTemplate } from './actions'
import { RetireTemplate } from './retire-template'
import { scopeLabel } from './scope-label'

type Row = RequirementTemplate & { readonly id: string }

const LAYER_LABELS: Record<RequirementLayer, string> = {
  STATE: 'State',
  SERVICE_TYPE: 'Service type',
  ROLE: 'Role',
  PAYER: 'Payer',
  AGENCY: 'Agency',
}

const PREVIEW_AXES = [
  { name: 'state', label: 'State', values: STATES },
  { name: 'serviceType', label: 'Service type', values: SERVICE_TYPES },
  { name: 'role', label: 'Role', values: CAREGIVER_ROLES },
  { name: 'payer', label: 'Payer', values: PAYERS },
] as const

function isAgencyOwned(template: Row): boolean {
  return template.scope.agencyId !== null && template.scope.agencyId !== undefined
}

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { key: 'key', header: 'Key', cell: (template) => template.key },
  { key: 'name', header: 'Name', cell: (template) => template.name },
  { key: 'layer', header: 'Layer', cell: (template) => LAYER_LABELS[template.layer] },
  { key: 'scope', header: 'Scope', cell: (template) => scopeLabel(template.scope) },
  {
    key: 'owner',
    header: 'Owner',
    cell: (template) => (isAgencyOwned(template) ? 'Your agency' : 'New York library'),
  },
  { key: 'type', header: 'Type', cell: (template) => template.type },
  {
    key: 'blocks',
    header: 'Blocks clearance',
    cell: (template) => (template.blocksClearance ? 'Yes' : 'No'),
  },
  {
    key: 'manual',
    header: 'Manual only',
    cell: (template) => (template.manualOnly ? `Yes: ${template.manualOnlyReason ?? ''}` : 'No'),
  },
  { key: 'version', header: 'Version', cell: (template) => template.version },
  {
    key: 'actions',
    header: 'Actions',
    align: 'end',
    cell: (template) =>
      isAgencyOwned(template) ? (
        <div className="flex items-start justify-end gap-3">
          <Link
            href={`/admin/requirements/${template.id}/edit`}
            className="text-sm font-medium underline"
          >
            Edit
          </Link>
          <RetireTemplate action={retireTemplate.bind(null, template.id)} />
        </div>
      ) : (
        <Link
          href={`/admin/requirements/${template.id}/override`}
          className="text-sm font-medium underline"
        >
          Override
        </Link>
      ),
  },
]

function param(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export default async function RequirementTemplatesPage(
  props: PageProps<'/admin/requirements'>,
) {
  const { principal } = await requireStaffSession()
  if (!can(principal, 'requirementTemplate.manage')) notFound()

  const searchParams = await props.searchParams
  const templates = await runAsPrincipal(principal, {}, () => listRequirementTemplates({}))
  const rows = [...templates].sort(
    (a, b) =>
      a.key.localeCompare(b.key) || LAYER_PRECEDENCE[a.layer] - LAYER_PRECEDENCE[b.layer],
  )

  const choice =
    'state' in searchParams
      ? scopeChoiceSchema.safeParse({
          state: param(searchParams.state),
          serviceType: param(searchParams.serviceType),
          role: param(searchParams.role),
          payer: param(searchParams.payer),
        })
      : null
  const preview = choice?.success
    ? await runAsPrincipal(principal, {}, () =>
        previewRequirementResolution({ context: choice.data }),
      )
    : null

  return (
    <>
      <PageHeader
        title="Requirements"
        description="The New York rules and your agency's own. Each save publishes a new version."
        actions={
          <Link href="/admin/requirements/new" className="text-sm font-medium underline">
            Add a requirement
          </Link>
        }
      />
      <div className="flex flex-col gap-8">
        <DataTable
          caption="Live requirement templates"
          columns={COLUMNS}
          rows={rows}
          getRowKey={(template) => template.id}
        />

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Preview</h2>
          <form method="get" className="flex flex-wrap items-end gap-4">
            {PREVIEW_AXES.map((axis) => (
              <SelectField
                key={axis.name}
                name={axis.name}
                label={axis.label}
                options={[
                  { value: '', label: 'Any / none' },
                  ...axis.values.map((value) => ({ value, label: value })),
                ]}
                defaultValue={param(searchParams[axis.name]) ?? ''}
                containerClassName="w-48"
              />
            ))}
            <SubmitButton variant="secondary">Preview</SubmitButton>
          </form>

          {choice !== null && !choice.success ? (
            <Alert tone="danger">Choose values from the lists to preview.</Alert>
          ) : null}
          {preview?.ok === true ? (
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {preview.requirements.map((template) => (
                <li key={template.id}>
                  {template.key}: {template.name} ({scopeLabel(template.scope)}, version{' '}
                  {template.version})
                </li>
              ))}
            </ul>
          ) : null}
          {preview?.ok === false ? (
            <Alert tone="warning" title="This caregiver's requirements are ambiguous">
              <ul className="flex flex-col gap-1">
                {preview.ambiguities.map((ambiguity) => (
                  <li key={ambiguity.key}>
                    {ambiguity.key}:{' '}
                    {ambiguity.candidates.map((candidate) => scopeLabel(candidate.scope)).join(' vs ')}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </section>
      </div>
    </>
  )
}
