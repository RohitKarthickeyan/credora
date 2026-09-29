import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { viewIntakeOverview } from '@/server/intake/flow'
import { Card } from '@/ui/card'
import { EmptyState } from '@/ui/empty-state'
import { PageHeader } from '@/ui/page-header'
import { ProgressBar } from '@/ui/progress-bar'

export const metadata: Metadata = { title: 'Your paperwork' }

const PRIMARY_LINK =
  'inline-flex min-h-touch w-full items-center justify-center rounded-control bg-brand-600 px-4 font-medium text-ink-inverse hover:bg-brand-700'
const SECTION_LINK = 'inline-flex min-h-touch items-center font-medium text-brand-700'

export default async function IntakeOverviewPage() {
  const principal = await requireCaregiverSession()
  const progress = await runAsPrincipal(principal, {}, () =>
    viewIntakeOverview({ caregiverId: principal.caregiverId }),
  )
  const firstIncomplete = progress.sections.find((section) => section.missing.length > 0)

  return (
    <>
      <PageHeader title="Your paperwork" />
      {progress.total === 0 ? (
        <EmptyState title="Nothing to fill in right now" />
      ) : (
        <div className="flex flex-col gap-6">
          <ProgressBar
            value={progress.completed}
            max={progress.total}
            label={`${progress.completed} of ${progress.total} sections done`}
          />
          {firstIncomplete ? (
            <Link href={`/intake/${firstIncomplete.id}`} className={PRIMARY_LINK}>
              Continue
            </Link>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-ink">You&apos;ve answered every question.</p>
              <Link href="/sign" className={PRIMARY_LINK}>
                Continue to signing
              </Link>
            </div>
          )}
          <div className="flex flex-col gap-4">
            {progress.sections.map((section) => (
              <Card key={section.id} title={section.title}>
                <div className="flex flex-col items-start gap-3">
                  {section.missing.length === 0 ? (
                    <p className="text-sm text-ink-muted">Done</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm text-ink-muted">Still missing:</p>
                      <ul className="list-disc pl-5 text-sm text-ink">
                        {section.missing.map((label) => (
                          <li key={label}>{label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Link href={`/intake/${section.id}`} className={SECTION_LINK}>
                    {section.missing.length === 0 ? 'Edit' : 'Finish this section'}
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
