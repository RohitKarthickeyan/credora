import type { PortName } from './names'

/**
 * Transient: a 429, a 503, a timeout. Thrown, so the queue retries it (drain.ts turns an
 * escaping exception into `retry`). A permanent vendor answer is a modelled return value instead.
 * `retryAfterMs` carries a vendor's `Retry-After` into `JobOutcome.retryAfterMs`.
 */
export class VendorUnavailableError extends Error {
  constructor(
    readonly port: PortName,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'VendorUnavailableError'
  }
}

/** A configuration fault — an unknown adapter selected. Retrying never fixes it. */
export class PortNotAvailableError extends Error {
  constructor(
    readonly port: PortName,
    readonly reason: 'unknown-adapter',
    message: string,
  ) {
    super(message)
    this.name = 'PortNotAvailableError'
  }
}
