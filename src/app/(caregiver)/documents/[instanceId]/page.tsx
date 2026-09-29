import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UPLOADABLE_STATUSES } from '@/domain/documents/upload'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { viewOwnDocumentRequests } from '@/server/documents/uploads'
import { Alert } from '@/ui/alert'
import { PageHeader } from '@/ui/page-header'
import { CaptureForm } from '../_components/capture-form'

export const metadata: Metadata = { title: 'Add a photo' }

const BACK = { href: '/documents', label: 'Your documents' }

export default async function CapturePage(props: PageProps<'/documents/[instanceId]'>) {
  const { instanceId } = await props.params
  const principal = await requireCaregiverSession()
  const requests = await runAsPrincipal(principal, {}, () =>
    viewOwnDocumentRequests({ caregiverId: principal.caregiverId }),
  )
  const request = requests.find((candidate) => candidate.instanceId === instanceId)
  if (request === undefined) notFound()

  if (!UPLOADABLE_STATUSES.includes(request.status)) {
    return (
      <>
        <PageHeader title={request.name} back={BACK} />
        <Alert tone="success">Your agency already has this one.</Alert>
      </>
    )
  }

  return (
    <>
      <PageHeader title={request.name} back={BACK} />
      <CaptureForm instanceId={request.instanceId} options={request.options} />
    </>
  )
}
