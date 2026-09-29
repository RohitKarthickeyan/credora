import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string
  description?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-2 py-4">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex min-h-touch items-center gap-1 self-start text-sm font-medium text-brand-700"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-4">
            <path d="M10.3 2.3 4.6 8l5.7 5.7 1.1-1.1L6.8 8l4.6-4.6z" />
          </svg>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="text-ink-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
    </header>
  )
}
