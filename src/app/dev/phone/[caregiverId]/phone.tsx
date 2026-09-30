'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useRef } from 'react'
import { sendFromPhone } from './actions'

type PhoneMessage = {
  id: string
  fromCaregiver: boolean
  team: boolean
  body: string
  hasMedia: boolean
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g

function Linkified({ text }: { text: string }) {
  return text.split(URL_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} target="_blank" rel="noreferrer" className="underline">
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

export function Phone({
  caregiverId,
  name,
  mobilePhone,
  messages,
}: {
  caregiverId: string
  name: string
  mobilePhone: string | null
  messages: readonly PhoneMessage[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(timer)
  }, [router])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send(formData: FormData) {
    await sendFromPhone(caregiverId, formData)
    formRef.current?.reset()
    router.refresh()
  }

  return (
    <div className="flex h-[700px] w-[375px] flex-col overflow-hidden rounded-[2rem] border-4 border-ink bg-white shadow-lg">
      <header className="border-b border-border p-3 text-center text-sm">
        <p className="font-medium">{name}</p>
        <p className="text-ink-muted">{mobilePhone ?? 'No mobile number'}</p>
      </header>

      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.fromCaregiver
                ? 'max-w-[80%] self-end rounded-2xl bg-blue-500 px-3 py-2 text-sm text-white'
                : 'max-w-[80%] self-start rounded-2xl bg-gray-200 px-3 py-2 text-sm text-black'
            }
          >
            {message.team ? <p className="text-xs font-medium">Team</p> : null}
            {message.hasMedia ? <p className="text-xs italic">[photo]</p> : null}
            <p className="whitespace-pre-wrap break-words">
              <Linkified text={message.body} />
            </p>
          </li>
        ))}
        <div ref={endRef} />
      </ul>

      <form ref={formRef} action={send} className="flex items-center gap-2 border-t border-border p-2">
        <label className="cursor-pointer text-sm" title="Attach a photo">
          <span aria-hidden>+</span>
          <span className="sr-only">Attach photo</span>
          <input type="file" name="media" accept="image/*,application/pdf" className="hidden" />
        </label>
        <input
          name="body"
          autoComplete="off"
          placeholder="Text message"
          className="min-w-0 flex-1 rounded-full border border-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-full bg-blue-500 px-3 py-2 text-sm font-medium text-white">
          Send
        </button>
      </form>
    </div>
  )
}
