'use client'

import type { ComponentProps } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from './button'

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, 'type'> & {
  pendingLabel?: string
}

export function SubmitButton({ pendingLabel, children, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button {...props} type="submit" disabled={disabled || pending}>
      {pending ? (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="size-4 animate-spin"
          >
            <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
            <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
          </svg>
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
