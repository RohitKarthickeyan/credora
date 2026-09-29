import { notFound } from 'next/navigation'
import type { CustomFieldMapping } from '@/domain/sync/alayacare-mapping'
import { runAsPrincipal } from '@/server/auth/context'
import { can } from '@/server/auth/policy'
import { requireStaffSession } from '@/server/auth/session'
import { loadAlayaCareMapping } from '@/server/sync/alayacare-mapping'
import type { Column } from '@/ui/data-table'
import { DataTable } from '@/ui/data-table'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'
import { SubmitButton } from '@/ui/submit-button'
import { addCustomField, removeCustomField, saveCredentialCodes } from './actions'
import { CredentialCodesForm } from './credential-codes-form'
import { CustomFieldForm } from './custom-field-form'
import { sourceLabel } from './source-options'

function columns(version: number): ReadonlyArray<Column<CustomFieldMapping>> {
  return [
    { key: 'alayaCareKey', header: 'AlayaCare key', cell: (field) => field.alayaCareKey },
    { key: 'alayaCareType', header: 'Type', cell: (field) => field.alayaCareType },
    { key: 'source', header: 'Source', cell: (field) => sourceLabel(field.source) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (field) => (
        <form action={removeCustomField.bind(null, version, field.alayaCareKey)}>
          <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
            Remove
          </SubmitButton>
        </form>
      ),
    },
  ]
}

export default async function AlayaCareMappingPage() {
  const { principal } = await requireStaffSession()
  // A 404 rather than a ForbiddenError: a coordinator is not told the page exists.
  if (!can(principal, 'alayaCareMapping.manage')) notFound()

  const { version, mapping } = await runAsPrincipal(principal, {}, () => loadAlayaCareMapping({}))

  return (
    <>
      <PageHeader
        title="AlayaCare mapping"
        description="How this agency's caregivers land in AlayaCare. Keys and codes are checked against AlayaCare only when a sync runs."
      />
      <div key={version} className="flex flex-col gap-8">
        <CredentialCodesForm
          action={saveCredentialCodes.bind(null, version)}
          credentialCodes={mapping.credentialCodes}
        />
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Custom fields</h2>
          <CustomFieldForm action={addCustomField.bind(null, version)} />
          <DataTable
            caption="Custom fields"
            columns={columns(version)}
            rows={mapping.customFields}
            getRowKey={(field) => field.alayaCareKey}
            empty={
              <EmptyState
                title="No custom fields mapped"
                description="No AlayaCare custom field is filled until one is added."
              />
            }
          />
        </section>
      </div>
    </>
  )
}
