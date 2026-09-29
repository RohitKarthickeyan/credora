import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60'

const VARIANT = {
  primary: 'bg-brand-600 text-ink-inverse hover:bg-brand-700',
  secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-status-danger-fg text-ink-inverse hover:opacity-90',
} as const

const SIZE = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-touch px-4 text-field',
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
    />
  )
}
