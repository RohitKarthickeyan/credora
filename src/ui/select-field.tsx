import type { SelectHTMLAttributes } from 'react'
import { cn } from './cn'
import type { FieldProps } from './text-field'

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> &
  FieldProps & {
    options: ReadonlyArray<{ value: string; label: string }>
    placeholder?: string
  }

export function SelectField({
  name,
  label,
  hint,
  error,
  size = 'md',
  containerClassName,
  className,
  options,
  placeholder,
  ...props
}: SelectFieldProps) {
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
      <select
        {...props}
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
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
