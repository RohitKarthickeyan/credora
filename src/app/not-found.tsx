import Link from 'next/link'
import { EmptyState } from '@/ui/empty-state'

export default function NotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 py-8">
      <EmptyState
        title="Page not found"
        description="That link may have expired or been mistyped."
        action={
          <Link
            href="/"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-600 px-4 text-field font-medium text-ink-inverse"
          >
            Go to the start
          </Link>
        }
      />
    </main>
  )
}
