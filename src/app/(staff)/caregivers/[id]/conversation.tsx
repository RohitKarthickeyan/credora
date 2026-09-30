'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { Button } from '@/ui/button'
import { StatusBadge } from '@/ui/status-badge'
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
  messages,
}: {
  caregiverId: string
  paused: boolean
  handedOff: boolean
  messages: readonly TranscriptMessage[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [router])

  async function send(formData: FormData) {
    await sendStaffTextAction(caregiverId, formData)
    formRef.current?.reset()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {paused ? <StatusBadge tone="warning" label="Paused" glyph="clock" size="sm" /> : null}
        {handedOff ? <StatusBadge tone="danger" label="Handed off" glyph="alert" size="sm" /> : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => pauseConversationAction(caregiverId, !paused)}
        >
          {paused ? 'Resume agent' : 'Pause agent'}
        </Button>
      </div>

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

      <form ref={formRef} action={send} className="flex items-center gap-2">
        <input
          name="body"
          autoComplete="off"
          aria-label="Reply to the caregiver"
          placeholder="Reply as staff"
          className="min-h-9 min-w-0 flex-1 rounded-control border border-border-strong px-3 text-sm"
        />
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    </div>
  )
}
