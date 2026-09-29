import type { Metadata } from 'next'
import Link from 'next/link'
import { UPLOADABLE_STATUSES } from '@/domain/documents/upload'
import { REQUIREMENT_STATUS_PRESENTATION } from '@/app/_lib/status'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { viewOwnDocumentRequests } from '@/server/documents/uploads'
import { Card } from '@/ui/card'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'
import { StatusBadge } from '@/ui/status-badge'

export const metadata: Metadata = { title: 'Your documents' }

export default async function DocumentsPage() {
  const principal = await requireCaregiverSession()
  const requests = await runAsPrincipal(principal, {}, () =>
    viewOwnDocumentRequests({ caregiverId: principal.caregiverId }),
  )

  return (
    <>
      <PageHeader title="Your documents" />
      {requests.length === 0 ? (
        <EmptyState title="Nothing to upload right now" />
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((request) => (
            <Card key={request.instanceId} title={request.name}>
              <div className="flex flex-col items-start gap-3">
                <StatusBadge {...REQUIREMENT_STATUS_PRESENTATION[request.status]} />
                {request.uploadCount > 0 ? (
                  <p className="text-sm text-ink-muted">
                    {request.uploadCount === 1 ? '1 file sent' : `${request.uploadCount} files sent`}
                  </p>
                ) : null}
                {UPLOADABLE_STATUSES.includes(request.status) ? (
                  <Link
                    href={`/documents/${request.instanceId}`}
                    className="inline-flex min-h-touch items-center font-medium text-brand-700"
                  >
                    Add a photo
                  </Link>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
