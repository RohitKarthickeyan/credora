import type { ReactNode } from 'react'

export function Card({
  title,
  action,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      {title !== undefined || action !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title !== undefined ? (
            <h2 className="text-base font-semibold text-ink">{title}</h2>
          ) : null}
          {action}
        </header>
      ) : null}
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}
