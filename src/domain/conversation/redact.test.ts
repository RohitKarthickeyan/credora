import { describe, expect, it } from 'vitest'
import { redactSsn } from './redact'

describe('redactSsn', () => {
  it('redacts an SSN typed with dashes, spaces or inside a sentence', () => {
    expect(redactSsn('my ssn is 123-45-6789 thanks')).toEqual({ redacted: 'my ssn is [SSN] thanks', ssn: '123456789' })
    expect(redactSsn('123 45 6789')).toEqual({ redacted: '[SSN]', ssn: '123456789' })
    expect(redactSsn('123456789')).toEqual({ redacted: '[SSN]', ssn: '123456789' })
  })

  it('leaves dates, zip codes and phone numbers alone', () => {
    expect(redactSsn('born 03/14/1988, zip 11201, call 7185551234')).toEqual({
      redacted: 'born 03/14/1988, zip 11201, call 7185551234',
      ssn: null,
    })
  })
})
