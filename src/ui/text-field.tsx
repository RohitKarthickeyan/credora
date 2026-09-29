import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export type FieldProps = {
  name: string
  label: string
  hint?: ReactNode
  error?: string
  size?: 'sm' | 'md'
  containerClassName?: string
}

// The HTML size attribute is a number; FieldProps reuses the name for the touch-target
// scale, so the DOM one is dropped. Width is a Tailwind class on every field.
type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FieldProps

export function TextField({
  name,
  label,
  hint,
  error,
  size = 'md',
  containerClassName,
  className,
  ...props
}: TextFieldProps) {
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
        id={name}
        name={name}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          'w-full rounded-control border bg-surface px-3 text-field text-ink transition-colors placeholder:text-ink-muted',
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
