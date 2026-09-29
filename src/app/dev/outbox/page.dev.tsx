import { devOutbox } from '@/server/dev/outbox'

// Bodies are rendered verbatim so a one-time code or invite link sent through the mock can be
// read here. Safe only because next.config.ts excludes .dev.tsx from the production build
// (ADR-011), so this page has no production route.
export default async function DevOutboxPage() {
  const messages = await devOutbox()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Outbox</h1>

      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">No messages sent yet.</p>
      ) : (
        <ul className="flex flex-col gap-4 font-mono text-sm">
          {messages.map((message) => (
            <li key={message.id} className="flex flex-col gap-1 border-b border-border pb-4">
              <p className="text-ink-muted">
                {message.createdAt.toISOString()} · {message.to} · agency{' '}
                {message.agencyId}
              </p>
              <p>{message.subject}</p>
              <pre className="whitespace-pre-wrap">{message.body}</pre>
              <p className="text-ink-muted">{message.providerMessageId}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
