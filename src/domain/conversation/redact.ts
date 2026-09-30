const SSN_PATTERN = /(?<!\d)(\d{3})[- ]?(\d{2})[- ]?(\d{4})(?!\d)/g

export const SSN_PLACEHOLDER = '[SSN]'

export function redactSsn(text: string): { readonly redacted: string; readonly ssn: string | null } {
  let ssn: string | null = null
  const redacted = text.replace(SSN_PATTERN, (_match, area: string, group: string, serial: string) => {
    ssn ??= `${area}${group}${serial}`
    return SSN_PLACEHOLDER
  })
  return { redacted, ssn }
}
