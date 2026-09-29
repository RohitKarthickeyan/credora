export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max === 0 ? 0 : (value / max) * 100

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink-muted">{label}</p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
      >
        <div className="h-full rounded-pill bg-brand-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
