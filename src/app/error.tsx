'use client'

import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'

// This boundary can be reached with a caregiver record in scope, so it shows the digest and
// nothing else from the error: a message must never carry a field value out of the page.
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[28rem] flex-col gap-4 px-4 py-8">
      <Alert tone="danger" title="Something went wrong" live>
        Try again. If it keeps happening, tell your coordinator
        {error.digest ? ` and give them reference ${error.digest}` : null}.
      </Alert>
      <Button className="self-start" onClick={() => retry()}>
        Try again
      </Button>
    </main>
  )
}
