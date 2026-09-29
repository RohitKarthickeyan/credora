import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'
import type { FieldProps } from './text-field'

// Expiries and dates of birth are dates, not instants: the value stays the yyyy-MM-dd string
// the input emits and this primitive never constructs a Date.
type DateFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> &
  FieldProps

export function DateField({
  name,
  label,
  hint,
  error,
  size = 'md',
  containerClassName,
  className,
  ...props
}: DateFieldProps) {
  const describedBy =
    [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${name}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        type="date"
        id={name}
        name={name}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          'w-full rounded-control border bg-surface px-3 text-field text-ink transition-colors',
          error ? 'border-status-danger-border' : 'border-border-strong',
          size === 'md' ? 'min-h-touch' : 'min-h-9',
          className,
        )}
      />
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
