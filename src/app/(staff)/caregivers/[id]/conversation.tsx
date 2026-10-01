'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef } from 'react'
import { Alert } from '@/ui/alert'
import { StatusBadge } from '@/ui/status-badge'
import { SubmitButton } from '@/ui/submit-button'
import { pauseConversationAction, sendStaffTextAction } from './actions'

type TranscriptMessage = {
  id: string
  fromCaregiver: boolean
  author: 'CAREGIVER' | 'AGENT' | 'STAFF'
  body: string
  hasMedia: boolean
}

const AUTHOR_LABEL = { CAREGIVER: null, AGENT: null, STAFF: 'Staff' } as const

export function Conversation({
  caregiverId,
  paused,
  handedOff,
  needsReply,
  messages,
}: {
  caregiverId: string
  paused: boolean
  handedOff: boolean
  needsReply: boolean
  messages: readonly TranscriptMessage[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [router])

  const [pauseState, pauseAction] = useActionState(pauseConversationAction, {})
  const [sendState, sendAction] = useActionState(sendStaffTextAction, {})
  // Keyed to the transcript's last message: it changes once a send lands, so a double submit of
  // the same render repeats the key and a new reply gets a new one.
  const idempotencyKey = `${caregiverId}:${messages.at(-1)?.id ?? 'empty'}`

  useEffect(() => {
    if (sendState.sent) formRef.current?.reset()
  }, [sendState])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {paused ? <StatusBadge tone="warning" label="Paused" glyph="clock" size="sm" /> : null}
        {handedOff ? <StatusBadge tone="danger" label="Handed off" glyph="alert" size="sm" /> : null}
        {needsReply ? <StatusBadge tone="danger" label="Needs reply" glyph="alert" size="sm" /> : null}
        <form action={pauseAction}>
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <input type="hidden" name="paused" value={String(!paused)} />
          <SubmitButton variant="secondary" size="sm">
            {paused ? 'Resume agent' : 'Pause agent'}
          </SubmitButton>
        </form>
      </div>
      {pauseState.error ? (
        <Alert tone="danger" live>
          {pauseState.error}
        </Alert>
      ) : null}

      <ul className="flex max-h-[480px] flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface-sunken p-3">
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.fromCaregiver
                ? 'max-w-[60%] self-start rounded-2xl bg-gray-200 px-3 py-2 text-sm text-black'
                : 'max-w-[60%] self-end rounded-2xl bg-blue-500 px-3 py-2 text-sm text-white'
            }
          >
            {AUTHOR_LABEL[message.author] ? (
              <p className="text-xs font-medium">{AUTHOR_LABEL[message.author]}</p>
            ) : null}
            {message.hasMedia ? (
              <p className="text-xs italic">[photo]</p>
            ) : null}
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </li>
        ))}
      </ul>

      {sendState.error ? (
        <Alert tone="danger" live>
          {sendState.error}
        </Alert>
      ) : null}
      <form ref={formRef} action={sendAction} className="flex items-center gap-2">
        <input type="hidden" name="caregiverId" value={caregiverId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input
          name="body"
          autoComplete="off"
          aria-label="Reply to the caregiver"
          placeholder="Reply as staff"
          className="min-h-9 min-w-0 flex-1 rounded-control border border-border-strong px-3 text-sm"
        />
        <SubmitButton size="sm" pendingLabel="Sending…">
          Send
        </SubmitButton>
      </form>
    </div>
  )
}
