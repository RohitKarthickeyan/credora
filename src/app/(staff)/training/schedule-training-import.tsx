'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '@/ui/alert'
import { SubmitButton } from '@/ui/submit-button'
import { TextField } from '@/ui/text-field'
import { scheduleTrainingImportAction } from './actions'

export function ScheduleTrainingImport(): ReactNode {
  const [state, formAction] = useActionState(scheduleTrainingImportAction, {})

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <TextField
        name="sourceRef"
        label="Export file"
        hint="The file the training platform exports each day. It is read once a day."
        required
        containerClassName="w-full max-w-md"
      />
      <SubmitButton pendingLabel="Scheduling…">Import daily</SubmitButton>
    </form>
  )
}
