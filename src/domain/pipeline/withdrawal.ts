import { z } from 'zod'

export const WITHDRAWAL_REASON_MAX_LENGTH = 500

export const withdrawCaregiverInputSchema = z.strictObject({
  caregiverId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(1, 'Give a reason for withdrawing this caregiver.')
    .max(WITHDRAWAL_REASON_MAX_LENGTH),
})
