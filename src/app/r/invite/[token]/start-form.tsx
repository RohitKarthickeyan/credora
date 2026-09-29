'use client'

import { useActionState } from 'react'
import { Alert } from '@/ui/alert'
import type { StatusTone } from '@/ui/status'
import { SubmitButton } from '@/ui/submit-button'
import type { StartOnboardingState } from './actions'
import { startOnboarding } from './actions'

const OUTCOMES: Record<
  NonNullable<StartOnboardingState['outcome']>,
  { tone: StatusTone; text: string }
> = {
  NOT_YOURS: { tone: 'danger', text: 'This invite is for someone else. Sign out and try again.' },
  USED: { tone: 'neutral', text: 'This invite link has already been used.' },
  EXPIRED: { tone: 'warning', text: 'This invite link has expired.' },
  INVALID: { tone: 'danger', text: "This link isn't valid." },
}

export function StartForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(() => startOnboarding(token), {})

  if (state.outcome !== undefined) {
    const { tone, text } = OUTCOMES[state.outcome]
    return (
      <Alert tone={tone} live>
        {text}
      </Alert>
    )
  }

  return (
    <form action={formAction}>
      <SubmitButton pendingLabel="Starting…" className="w-full">
        Start my paperwork
      </SubmitButton>
    </form>
  )
}
