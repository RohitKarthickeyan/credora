export const RETURN_REASONS = ['UNREADABLE', 'EXPIRED', 'NAME_NOT_FOUND', 'DOB_DIFFERS'] as const

export type ReturnReason = (typeof RETURN_REASONS)[number]
