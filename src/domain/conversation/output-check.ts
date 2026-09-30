import { redactSsn } from './redact'

export const MAX_REPLY_LENGTH = 480
const URL_PATTERN = /https?:\/\/[^\s]+/g

export function passesOutputCheck(text: string, allowedOrigins: readonly string[]): boolean {
  if (text.length > MAX_REPLY_LENGTH) return false
  if (redactSsn(text).ssn !== null) return false
  const urls = text.match(URL_PATTERN) ?? []
  return urls.every((url) => allowedOrigins.some((origin) => url.startsWith(`${origin}/`) || url === origin))
}
