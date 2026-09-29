import type { ReactNode } from 'react'

// Display only. It is handed an already-masked string and never the underlying value, so it
// cannot leak one; the reveal reason, the server action and the audit entry belong to T-019.
export function MaskedValue({
  label,
  masked,
  action,
}: {
  label: string
  masked: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="font-mono text-field tabular-nums text-ink">{masked}</span>
      </div>
      {action}
    </div>
  )
}
