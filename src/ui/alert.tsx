import type { ReactNode } from 'react'
import { cn } from './cn'
import type { StatusTone } from './status'

const TONE: Record<StatusTone, string> = {
  neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg',
  progress: 'border-status-progress-border bg-status-progress-bg text-status-progress-fg',
  info: 'border-status-info-border bg-status-info-bg text-status-info-fg',
  success: 'border-status-success-border bg-status-success-bg text-status-success-fg',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger-fg',
  muted: 'border-status-muted-border bg-status-muted-bg text-status-muted-fg',
}

export function Alert({
  tone,
  title,
  live,
  children,
}: {
  tone: StatusTone
  title?: string
  live?: boolean
  children: ReactNode
}) {
  return (
    <div
      role={live ? 'alert' : undefined}
      className={cn('flex flex-col gap-1 rounded-card border p-4', TONE[tone])}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className="text-sm">{children}</div>
    </div>
  )
}
