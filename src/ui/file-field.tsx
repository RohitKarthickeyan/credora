'use client'

import { useEffect, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { cn } from './cn'
import type { FieldProps } from './text-field'

// capture is a hint only: desktop browsers ignore it and some Android browsers open a chooser,
// so this stays a working plain file input.
type FileFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> &
  FieldProps & {
    accept?: string
    capture?: 'environment' | 'user'
    maxBytes?: number
  }

type Selected = { name: string; size: number; previewUrl: string | null }

function formatSize(bytes: number): string {
  const megabytes = bytes / 1_000_000
  return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`
}

export function FileField({
  name,
  label,
  hint,
  error,
  size = 'md',
  containerClassName,
  className,
  accept,
  capture,
  maxBytes,
  onChange,
  ...props
}: FileFieldProps) {
  const [selected, setSelected] = useState<Selected | null>(null)

  useEffect(() => {
    const previewUrl = selected?.previewUrl
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [selected])

  const tooLarge = maxBytes !== undefined && selected !== null && selected.size > maxBytes
  const resolvedHint = hint ?? (capture ? 'Take a photo or choose a file' : undefined)
  const describedBy =
    [resolvedHint ? `${name}-hint` : null, error ? `${name}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setSelected(
      file
        ? {
            name: file.name,
            size: file.size,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          }
        : null,
    )
    onChange?.(event)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      {resolvedHint ? (
        <p id={`${name}-hint`} className="text-sm text-ink-muted">
          {resolvedHint}
        </p>
      ) : null}
      <input
        {...props}
        type="file"
        id={name}
        name={name}
        accept={accept}
        capture={capture}
        onChange={handleChange}
        aria-describedby={describedBy}
        aria-invalid={error || tooLarge ? true : undefined}
        className={cn(
          'w-full rounded-control border bg-surface px-3 py-2 text-field text-ink file:mr-3 file:min-h-9 file:rounded-control file:border-0 file:bg-brand-600 file:px-3 file:text-sm file:font-medium file:text-ink-inverse',
          error || tooLarge ? 'border-status-danger-border' : 'border-border-strong',
          size === 'md' ? 'min-h-touch' : 'min-h-9',
          className,
        )}
      />
      {selected ? (
        <div className="flex items-center gap-3">
          {selected.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/image cannot optimise a blob URL for a file the user just picked
            <img
              src={selected.previewUrl}
              alt=""
              className="size-12 rounded-control border border-border object-cover"
            />
          ) : null}
          <p className="text-sm text-ink-muted">
            {selected.name} · {formatSize(selected.size)}
          </p>
        </div>
      ) : null}
      {tooLarge && maxBytes !== undefined ? (
        <p role="alert" className="text-sm text-status-danger-fg">
          That file is larger than {formatSize(maxBytes)}. Choose a smaller one.
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
