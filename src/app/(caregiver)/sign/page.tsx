import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { type SigningView, viewOwnSigning } from '@/server/forms/signing'
import { Alert } from '@/ui/alert'
import { Card } from '@/ui/card'
import { PageHeader } from '@/ui/page-header'
import { PrepareForm } from './_components/prepare-form'

export const metadata: Metadata = { title: 'Sign your documents' }

const SIGNED_ON = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' })

const LINK = 'inline-flex min-h-touch items-center font-medium text-brand-700'

function DocumentNames({ names }: { names: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  )
}

function Body({ view }: { view: SigningView }) {
  switch (view.state) {
    case 'not-ready':
      return (
        <Card>
          <div className="flex flex-col items-start gap-3">
            <p>Finish your questions first.</p>
            <Link href="/intake" className={LINK}>
              Go to your questions
            </Link>
          </div>
        </Card>
      )
    case 'ready':
      return (
        <div className="flex flex-col gap-4">
          {view.previous !== null ? (
            <Alert tone="warning">
              {view.previous === 'DECLINED'
                ? 'Your last set of documents was declined. You can prepare a new set.'
                : 'Your last set of documents was cancelled. You can prepare a new set.'}
            </Alert>
          ) : null}
          <p>
            We will fill in your documents from your answers. You then sign them all at once, with
            one link.
          </p>
          <PrepareForm />
        </div>
      )
    case 'preparing':
      return (
        <Card title="Your documents">
          <div className="flex flex-col items-start gap-3">
            <DocumentNames names={view.documentNames} />
            <p className="text-ink-muted">We&apos;re preparing your documents. This can take a minute.</p>
            <Link href="/sign" className={LINK}>
              Check again
            </Link>
          </div>
        </Card>
      )
    case 'sent':
      return (
        <Card title="Your documents">
          <div className="flex flex-col gap-4">
            <DocumentNames names={view.documentNames} />
            {view.signingUrl === null ? (
              <p>Check your email for the signing link.</p>
            ) : (
              <a
                href={view.signingUrl}
                className="inline-flex min-h-touch items-center justify-center rounded-control bg-brand-600 px-4 font-medium text-ink-inverse hover:bg-brand-700"
              >
                Sign all {view.documentNames.length} documents
              </a>
            )}
          </div>
        </Card>
      )
    case 'signed':
      return (
        <Card title="Signed">
          <ul className="flex flex-col gap-2">
            {view.documents.map((document) => (
              <li key={document.name} className="flex flex-col">
                <span>{document.name}</span>
                <span className="text-sm text-ink-muted">Signed {SIGNED_ON.format(document.signedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )
  }
}

export default async function SignPage() {
  const principal = await requireCaregiverSession()
  const view = await runAsPrincipal(principal, {}, () =>
    viewOwnSigning({ caregiverId: principal.caregiverId }),
  )

  return (
    <>
      <PageHeader title="Sign your documents" />
      <Body view={view} />
    </>
  )
}
