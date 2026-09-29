import { getPort } from '@/integrations/registry'
import { webhookProviderSchema } from '@/server/webhooks/jobs'
import type { WebhookTarget } from '@/server/webhooks/receive'
import { receiveWebhook, webhookDeliveryFrom } from '@/server/webhooks/receive'

// Any non-2xx makes a real vendor redeliver, which is what an unmatched subject needs.
const STATUS_BY_OUTCOME = { accepted: 200, rejected: 401, unmatched: 409 } as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const parsed = webhookProviderSchema.safeParse((await params).provider)
  if (!parsed.success) return Response.json({ received: false }, { status: 404 })

  const target: WebhookTarget =
    parsed.data === 'esign'
      ? { provider: 'esign', port: getPort('esign') }
      : { provider: 'backgroundCheck', port: getPort('backgroundCheck') }

  const outcome = await receiveWebhook(target, await webhookDeliveryFrom(request))
  return Response.json(
    { received: outcome.status === 'accepted' },
    { status: STATUS_BY_OUTCOME[outcome.status] },
  )
}
