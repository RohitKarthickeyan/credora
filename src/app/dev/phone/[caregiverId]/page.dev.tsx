import { notFound } from 'next/navigation'
import { devPhone } from '@/server/dev/phone'
import { Phone } from './phone'

export default async function DevPhonePage({ params }: { params: Promise<{ caregiverId: string }> }) {
  const { caregiverId } = await params
  const phone = await devPhone(caregiverId)
  if (phone === null) notFound()

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Phone
        caregiverId={caregiverId}
        name={phone.name}
        mobilePhone={phone.mobilePhone}
        messages={phone.messages.map((message) => ({
          id: message.id,
          fromCaregiver: message.direction === 'INBOUND',
          team: message.author === 'STAFF',
          body: message.body,
          hasMedia: message.mediaStorageKey !== null,
        }))}
      />
    </main>
  )
}
