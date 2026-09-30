'use server'

import { receiveText } from '@/server/conversation/receive'
import { devPhone } from '@/server/dev/phone'

// Exempt from the session sequence for the ADR-011 reason in src/app/dev/page.dev.tsx: this
// file has no production endpoint.
export async function sendFromPhone(caregiverId: string, formData: FormData): Promise<void> {
  const phone = await devPhone(caregiverId)
  if (phone === null || phone.mobilePhone === null) return

  const body = formData.get('body')
  const file = formData.get('media')
  const media = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null

  await receiveText({
    agencyId: phone.agencyId,
    from: phone.mobilePhone,
    body: typeof body === 'string' ? body : '',
    media,
  })
}
