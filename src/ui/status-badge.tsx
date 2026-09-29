import { cn } from './cn'
import type { StatusGlyph, StatusTone } from './status'

// Three encodings at once — label, glyph and border treatment — so a status is never carried
// by colour alone. Dashed borders mark the two "nothing is happening here" tones.
const TONE: Record<StatusTone, string> = {
  neutral:
    'border-dashed border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg',
  progress:
    'border-solid border-status-progress-border bg-status-progress-bg text-status-progress-fg',
  info: 'border-solid border-status-info-border bg-status-info-bg text-status-info-fg',
  success:
    'border-solid border-status-success-border bg-status-success-bg text-status-success-fg',
  warning:
    'border-solid border-status-warning-border bg-status-warning-bg text-status-warning-fg',
  danger: 'border-solid border-status-danger-border bg-status-danger-bg text-status-danger-fg',
  muted: 'border-dashed border-status-muted-border bg-status-muted-bg text-status-muted-fg',
}

const PATH: Record<StatusGlyph, string> = {
  dot: 'M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z',
  half: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.6v7.8a3.9 3.9 0 0 1 0-7.8Z',
  search: 'M7.2 2.6a4.6 4.6 0 1 0 2.86 8.2l2.67 2.67 1.13-1.13-2.67-2.67A4.6 4.6 0 0 0 7.2 2.6Zm0 1.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  check: 'M13.4 4.1 6.6 10.9 2.6 6.9 1.5 8l5.1 5.1 7.9-7.9z',
  alert: 'M8 1.5 15 14H1L8 1.5Zm-.8 4.3v4h1.6v-4H7.2Zm0 5.2v1.6h1.6V11H7.2Z',
  clock: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Zm0 1.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm-.8 1.4v3.5l2.9 1.7.8-1.35-2.1-1.25V4.8H7.2Z',
  slash: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Zm0 1.6c1 0 1.94.32 2.7.87l-6.43 6.43A4.6 4.6 0 0 1 8 3.4Zm3.83 2.03A4.6 4.6 0 0 1 8 12.6c-1 0-1.94-.32-2.7-.87l6.53-6.3Z',
}

const SIZE = {
  sm: 'gap-1 px-2 py-0.5 text-xs',
  md: 'gap-1.5 px-2.5 py-1 text-sm',
} as const

export function StatusBadge({
  tone,
  label,
  glyph,
  size = 'md',
}: {
  tone: StatusTone
  label: string
  glyph: StatusGlyph
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill border font-medium',
        TONE[tone],
        SIZE[size],
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="currentColor"
        className={size === 'md' ? 'size-4 shrink-0' : 'size-3 shrink-0'}
      >
        <path d={PATH[glyph]} />
      </svg>
      {label}
    </span>
  )
}
