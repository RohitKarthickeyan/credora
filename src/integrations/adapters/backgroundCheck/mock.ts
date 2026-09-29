import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  backgroundCheckEventSchema,
  backgroundCheckStatusSchema,
  orderBackgroundCheckInputSchema,
} from '@/integrations/ports/backgroundCheck'
import type {
  BackgroundCheckOrder,
  BackgroundCheckPort,
  BackgroundCheckStatus,
} from '@/integrations/ports/backgroundCheck'
import type { WebhookDelivery } from '@/integrations/ports/webhook'
import { env } from '@/lib/env'

type MockAdvanceResult =
  | { readonly advanced: true; readonly order: BackgroundCheckOrder; readonly delivery: WebhookDelivery }
  | { readonly advanced: false; readonly reason: 'unknown-order' | 'illegal-transition' }

export type MockBackgroundCheckOrder = {
  readonly agencyId: string
  readonly orderId: string
  readonly status: BackgroundCheckStatus
}

type MockBackgroundCheck = BackgroundCheckPort & {
  /** The dev control (INTEGRATIONS.md § Ports). Never called by a timer. */
  advance(agencyId: string, orderId: string, to: BackgroundCheckStatus, occurredAt: string): Promise<MockAdvanceResult>
  /** The dev page's list: every order across agencies. The mock holds no subject data, so this lists none. */
  listOrders(): Promise<readonly MockBackgroundCheckOrder[]>
}

// Not a credential: the mock verifies only its own deliveries (ADR-033).
const SIGNING_KEY = 'credora-mock-background-check'
const SIGNATURE_HEADER = 'x-credora-mock-signature'
const SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/
// The path-traversal defence: the dev page passes a form field straight in.
const ORDER_ID_PATTERN = /^bgc_mock_[0-9a-f]{24}$/

const TRANSITIONS: Readonly<Record<BackgroundCheckStatus, readonly BackgroundCheckStatus[]>> = {
  ORDERED: ['PENDING'],
  PENDING: ['CLEAR', 'CONSIDER'],
  CLEAR: [],
  CONSIDER: [],
}

const stateSchema = z.object({
  agencyId: z.uuid(),
  orderId: z.string().regex(ORDER_ID_PATTERN),
  status: backgroundCheckStatusSchema,
})

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENOENT'
}

function sign(rawBody: string): string {
  return createHmac('sha256', SIGNING_KEY).update(rawBody).digest('hex')
}

export function createMockBackgroundCheck(options?: { readonly stateDir?: string }): MockBackgroundCheck {
  const stateDir = options?.stateDir ?? path.join(env.STORAGE_ROOT, '_mock-background-check')

  function stateFile(orderId: string): string {
    return path.join(stateDir, `${orderId}.json`)
  }

  async function load(orderId: string): Promise<MockBackgroundCheckOrder | null> {
    if (!ORDER_ID_PATTERN.test(orderId)) return null

    let text: string
    try {
      text = await readFile(stateFile(orderId), 'utf8')
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    return stateSchema.parse(JSON.parse(text))
  }

  async function loadFor(agencyId: string, orderId: string): Promise<MockBackgroundCheckOrder | null> {
    const state = await load(orderId)
    return state === null || state.agencyId !== agencyId ? null : state
  }

  async function save(state: MockBackgroundCheckOrder): Promise<void> {
    await mkdir(stateDir, { recursive: true })
    await writeFile(stateFile(state.orderId), JSON.stringify(state))
  }

  return {
    async order(input) {
      const { agencyId, idempotencyKey } = orderBackgroundCheckInputSchema.parse(input)
      const orderId =
        'bgc_mock_' + createHash('sha256').update(`${agencyId}:${idempotencyKey}`).digest('hex').slice(0, 24)
      const existing = await loadFor(agencyId, orderId)
      if (existing !== null) return { orderId, status: existing.status }
      await save({ agencyId, orderId, status: 'ORDERED' })
      return { orderId, status: 'ORDERED' }
    },

    async getOrder(agencyId, orderId) {
      const state = await loadFor(agencyId, orderId)
      return state === null ? null : { orderId, status: state.status }
    },

    async advance(agencyId, orderId, to, occurredAt) {
      const state = await loadFor(agencyId, orderId)
      if (state === null) return { advanced: false, reason: 'unknown-order' }
      if (!TRANSITIONS[state.status].includes(to)) return { advanced: false, reason: 'illegal-transition' }

      const event = backgroundCheckEventSchema.parse({ orderId, status: to, occurredAt })
      await save({ agencyId, orderId, status: to })
      const rawBody = JSON.stringify({ orderId: event.orderId, status: event.status, occurredAt: event.occurredAt })
      return {
        advanced: true,
        order: { orderId, status: to },
        delivery: { rawBody, headers: { [SIGNATURE_HEADER]: `sha256=${sign(rawBody)}` } },
      }
    },

    async listOrders() {
      let names: string[]
      try {
        names = await readdir(stateDir)
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const ids = names
        .filter((name) => name.endsWith('.json') && ORDER_ID_PATTERN.test(name.slice(0, -'.json'.length)))
        .map((name) => name.slice(0, -'.json'.length))
        .sort()
      const orders = await Promise.all(ids.map(load))
      return orders.filter((order): order is MockBackgroundCheckOrder => order !== null)
    },

    verifyWebhook(delivery) {
      const header = delivery.headers[SIGNATURE_HEADER]
      if (header === undefined) return { valid: false, reason: `missing ${SIGNATURE_HEADER} header` }
      if (!SIGNATURE_PATTERN.test(header)) return { valid: false, reason: 'malformed signature' }
      const expected = Buffer.from(sign(delivery.rawBody), 'hex')
      if (!timingSafeEqual(Buffer.from(header.slice('sha256='.length), 'hex'), expected)) {
        return { valid: false, reason: 'signature mismatch' }
      }
      const parsed = backgroundCheckEventSchema.safeParse(JSON.parse(delivery.rawBody))
      return parsed.success ? { valid: true, event: parsed.data } : { valid: false, reason: 'malformed event' }
    },
  }
}
