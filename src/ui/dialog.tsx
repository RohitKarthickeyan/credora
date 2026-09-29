'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './button'

// Native <dialog>: the top layer, the backdrop, Escape and focus containment come from the
// browser rather than from us.
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) ref.current?.showModal()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-border bg-surface p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-4">
            <path d="M12.7 4.4 11.6 3.3 8 6.9 4.4 3.3 3.3 4.4 6.9 8l-3.6 3.6 1.1 1.1L8 9.1l3.6 3.6 1.1-1.1L9.1 8z" />
          </svg>
        </Button>
      </div>
      <div className="px-4 py-4">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
      ) : null}
    </dialog>
  )
}
