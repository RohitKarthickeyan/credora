import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CONTACT_SECTION } from '@/domain/forms/sections/contact'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { openIntakeStep } from '@/server/intake/flow'
import { ProgressBar } from '@/ui/progress-bar'
import { ContactPanel } from '../_contact/contact-panel'
import { SectionForm } from '../_components/section-form'
import { saveStep } from '../actions'

export const metadata: Metadata = { title: 'Your paperwork' }

export default async function IntakeStepPage({ params }: PageProps<'/intake/[step]'>) {
  const { step } = await params
  const principal = await requireCaregiverSession()
  const opened = await runAsPrincipal(principal, {}, () =>
    openIntakeStep({ caregiverId: principal.caregiverId, stepId: step }),
  )
  if (opened === null) notFound()

  // The loaded section, not the constant: a number on file makes its field optional.
  return (
    <div className="flex flex-col gap-6">
      <ProgressBar value={opened.position} max={opened.total} label={`Step ${opened.position} of ${opened.total}`} />
      <Link href="/intake" className="inline-flex min-h-touch items-center self-start text-sm font-medium text-brand-700">
        All sections
      </Link>
      {opened.loaded.section.id === CONTACT_SECTION.id ? <ContactPanel /> : null}
      <SectionForm
        section={opened.loaded.section}
        defaultAnswers={opened.loaded.answers}
        onSubmit={saveStep.bind(null, step)}
      />
    </div>
  )
}
