import { findPhoneContext, listMessages, listPhoneCaregivers } from '@/db/repositories/conversations'

const PHONE_MESSAGE_LIMIT = 200

export async function devPhone(caregiverId: string) {
  const context = await findPhoneContext(caregiverId)
  if (context === null) return null
  const messages =
    context.conversationId === null
      ? []
      : await listMessages(context.agencyId, context.conversationId, PHONE_MESSAGE_LIMIT)
  return { ...context, messages }
}

export const devPhoneCaregivers = listPhoneCaregivers
