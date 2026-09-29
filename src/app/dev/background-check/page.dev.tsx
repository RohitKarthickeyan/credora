import { revalidatePath } from 'next/cache'
import { createMockBackgroundCheck } from '@/integrations/adapters/backgroundCheck/mock'
import { backgroundCheckStatusSchema } from '@/integrations/ports/backgroundCheck'
import { env } from '@/lib/env'

const bgcheck = createMockBackgroundCheck()

const lastResult = new Map<string, string>()

const TARGETS = ['PENDING', 'CLEAR', 'CONSIDER'] as const

async function advance(formData: FormData) {
  'use server'
  // Exempt from the authenticate → authorize → validate → use case sequence: this page stands
  // in for the background-check vendor and has no production endpoint.
  const orderId = String(formData.get('orderId'))
  const agencyId = String(formData.get('agencyId'))
  const to = backgroundCheckStatusSchema.parse(formData.get('to'))
  const result = await bgcheck.advance(agencyId, orderId, to, new Date().toISOString())
  if (!result.advanced) {
    lastResult.set(orderId, `not advanced: ${result.reason}`)
  } else {
    try {
      const response = await fetch(new URL('/api/webhooks/backgroundCheck', env.APP_URL), {
        method: 'POST',
        headers: { ...result.delivery.headers, 'content-type': 'application/json' },
        body: result.delivery.rawBody,
      })
      lastResult.set(orderId, `delivered: HTTP ${response.status}`)
    } catch (error) {
      lastResult.set(orderId, `not delivered: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  revalidatePath('/dev/background-check')
}

export default async function MockBackgroundCheckPage() {
  const orders = await bgcheck.listOrders()

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Mock background check vendor</h1>
      <p className="text-sm text-ink-muted">
        This page stands in for the background-check vendor. Advancing an order posts its signed callback to Credora.
      </p>

      {orders.length === 0 ? (
        <p className="text-sm text-ink-muted">No orders yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((order) => {
            const result = lastResult.get(order.orderId)
            return (
              <li key={order.orderId} className="flex flex-col gap-1 rounded-md border border-border p-3">
                <p className="font-mono text-sm break-all">{order.orderId}</p>
                <p className="text-sm text-ink-muted">Agency {order.agencyId}</p>
                <p className="text-sm">Status: {order.status}</p>
                {order.status === 'CLEAR' || order.status === 'CONSIDER' ? null : (
                  <form action={advance} className="flex gap-2">
                    <input type="hidden" name="orderId" value={order.orderId} />
                    <input type="hidden" name="agencyId" value={order.agencyId} />
                    {TARGETS.map((to) => (
                      <button
                        key={to}
                        type="submit"
                        name="to"
                        value={to}
                        className="min-h-11 rounded-md border border-border px-4 text-sm font-medium"
                      >
                        {to}
                      </button>
                    ))}
                  </form>
                )}
                {result === undefined ? null : <p className="font-mono text-sm">{result}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
