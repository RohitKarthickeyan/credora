import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      {action}
    </div>
  )
}
