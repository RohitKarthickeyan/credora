import type { Metadata } from 'next'
import Link from 'next/link'
import type { SummaryRow } from '@/domain/forms/summary'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { viewOwnUploads } from '@/server/documents/uploads'
import { viewOwnRecord } from '@/server/intake/flow'
import { Card } from '@/ui/card'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'

export const metadata: Metadata = { title: 'Your record' }

const RECEIVED_ON = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' })

const LINK = 'inline-flex min-h-touch items-center font-medium text-brand-700'

function Rows({ rows }: { rows: readonly SummaryRow[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-sm text-ink-muted">{row.label}</dt>
          <dd className="text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// Requirement and check statuses are deliberately not shown here (OPEN-QUESTIONS 220).
export default async function RecordPage() {
  const principal = await requireCaregiverSession()
  const { sections, uploads } = await runAsPrincipal(principal, {}, async () => ({
    sections: await viewOwnRecord({ caregiverId: principal.caregiverId }),
    uploads: await viewOwnUploads({ caregiverId: principal.caregiverId }),
  }))

  return (
    <>
      <PageHeader title="Your record" description="This is everything you have given us." />
      <div className="flex flex-col gap-4">
        {sections.length === 0 ? <EmptyState title="Nothing on file yet" /> : null}
        {sections.map((section) => (
          <Card
            key={section.id}
            title={section.title}
            action={
              <Link href={`/intake/${section.id}`} className={LINK}>
                Change
              </Link>
            }
          >
            <div className="flex flex-col gap-4">
              {section.items.map((item) =>
                item.kind === 'field' ? (
                  <Rows key={item.label} rows={[item]} />
                ) : (
                  <div key={item.label} className="flex flex-col gap-2">
                    <h3 className="font-medium text-ink">{item.label}</h3>
                    {item.entries.length === 0 ? (
                      <p className="text-ink-muted">None</p>
                    ) : (
                      <ol className="flex flex-col gap-3">
                        {item.entries.map((rows, index) => (
                          <li key={index}>
                            <p className="text-sm font-medium text-ink">{index + 1}.</p>
                            <Rows rows={rows} />
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ),
              )}
            </div>
          </Card>
        ))}
        <Card title="Files you sent">
          {uploads.length === 0 ? (
            <EmptyState title="No files sent yet" />
          ) : (
            <ul className="flex flex-col gap-3">
              {uploads.map((upload) => (
                <li key={upload.uploadedDocumentId}>
                  <p className="text-ink">{upload.requirementName ?? 'Document'}</p>
                  <p className="text-sm text-ink-muted">Received {RECEIVED_ON.format(upload.uploadedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Signed documents">
          <Link href="/sign" className={LINK}>
            See the documents you signed
          </Link>
        </Card>
      </div>
    </>
  )
}
