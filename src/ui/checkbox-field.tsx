import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'
import type { FieldProps } from './text-field'

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> &
  FieldProps

export function CheckboxField({
  name,
  label,
  hint,
  error,
  size = 'md',
  containerClassName,
  className,
  ...props
}: CheckboxFieldProps) {
  const describedBy =
    [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {/* The label row carries the 44 px target, not the 20 px box. */}
      <label
        htmlFor={name}
        className={cn(
          'flex items-start gap-3 text-field text-ink',
          size === 'md' ? 'min-h-touch py-2.5' : 'min-h-9 py-1.5',
        )}
      >
        <input
          {...props}
          type="checkbox"
          id={name}
          name={name}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'mt-0.5 size-5 shrink-0 rounded border accent-brand-600',
            error ? 'border-status-danger-border' : 'border-border-strong',
            className,
          )}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p id={`${name}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
