export type WebhookDelivery = {
  readonly rawBody: string
  readonly headers: Readonly<Record<string, string>>
}

/** Produced synchronously — an HMAC comparison and a parse — so a route verifies before anything else. */
export type WebhookVerification<E> =
  | { readonly valid: true; readonly event: E }
  | { readonly valid: false; readonly reason: string }
