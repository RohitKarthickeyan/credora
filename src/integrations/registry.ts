import { createExportAlayaCare } from '@/integrations/adapters/alayacare/export'
import { createHttpAlayaCare } from '@/integrations/adapters/alayacare/http'
import { createMockBackgroundCheck } from '@/integrations/adapters/backgroundCheck/mock'
import { createMockEsign } from '@/integrations/adapters/esign/mock'
import { createMockExtraction } from '@/integrations/adapters/extraction/mock'
import { createClaudeJudge } from '@/integrations/adapters/judge/claude'
import { createMockJudge } from '@/integrations/adapters/judge/mock'
import { createMockMessaging } from '@/integrations/adapters/messaging/mock'
import { createLocalDiskStorage } from '@/integrations/adapters/storage/local'
import { createMockTraining } from '@/integrations/adapters/training/mock'
import { PortNotAvailableError } from '@/integrations/ports/errors'
import { PORT_NAMES, type PortName, type Ports } from '@/integrations/ports/names'
import { env } from '@/lib/env'

type PortSlot<N extends PortName> = {
  readonly variable: string
  readonly selected: string
  readonly adapters: Readonly<Record<string, () => Ports[N]>>
}

// The one place an adapter is chosen (INTEGRATIONS.md Rule 3). Each adapter task fills its own
// slot's `adapters`; factories run at resolve time, so one may call getPort for another port.
const slots: { [N in PortName]: PortSlot<N> } = {
  messaging: { variable: 'MESSAGING_ADAPTER', selected: env.MESSAGING_ADAPTER, adapters: { mock: () => createMockMessaging() } },
  esign: {
    variable: 'ESIGN_ADAPTER',
    selected: env.ESIGN_ADAPTER,
    adapters: { mock: () => createMockEsign({ storage: getPort('storage') }) },
  },
  extraction: {
    variable: 'EXTRACTION_ADAPTER',
    selected: env.EXTRACTION_ADAPTER,
    adapters: { mock: () => createMockExtraction({ storage: getPort('storage') }) },
  },
  judge: {
    variable: 'JUDGE_ADAPTER',
    selected: env.JUDGE_ADAPTER,
    adapters: { mock: () => createMockJudge(), claude: () => createClaudeJudge() },
  },
  backgroundCheck: {
    variable: 'BGCHECK_ADAPTER',
    selected: env.BGCHECK_ADAPTER,
    adapters: { mock: () => createMockBackgroundCheck() },
  },
  alayacare: {
    variable: 'ALAYACARE_ADAPTER',
    selected: env.ALAYACARE_ADAPTER,
    adapters: {
      mock: () => createHttpAlayaCare({ baseUrl: env.ALAYACARE_BASE_URL, storage: getPort('storage') }),
      export: () => createExportAlayaCare({ storage: getPort('storage') }),
    },
  },
  training: { variable: 'TRAINING_ADAPTER', selected: env.TRAINING_ADAPTER, adapters: { mock: () => createMockTraining() } },
  storage: {
    variable: 'STORAGE_ADAPTER',
    selected: env.STORAGE_ADAPTER,
    adapters: { local: () => createLocalDiskStorage() },
  },
}

const instances: { [N in PortName]?: Ports[N] } = {}

function factoryFor<N extends PortName>(name: N, adapterName: string): () => Ports[N] {
  const slot: PortSlot<N> = slots[name]
  const factory = slot.adapters[adapterName]
  if (factory === undefined) {
    throw new PortNotAvailableError(
      name,
      'unknown-adapter',
      `${slot.variable}="${adapterName}" is not a known ${name} adapter. ` +
        `Known: ${Object.keys(slot.adapters).join(', ')}. ` +
        `Adapters are registered in src/integrations/registry.ts (INTEGRATIONS.md Rule 3).`,
    )
  }
  return factory
}

function resolveAdapter<N extends PortName>(name: N, adapterName: string): Ports[N] {
  return factoryFor(name, adapterName)()
}

/** Run at server boot (src/instrumentation.ts): checks each selected name, constructs nothing. */
export function assertEveryPortResolves(): void {
  for (const name of PORT_NAMES) factoryFor(name, slots[name].selected)
}

/** Call at a composition boundary and pass the port down; a use case takes ports as parameters. */
export function getPort<N extends PortName>(name: N): Ports[N] {
  const existing = instances[name]
  if (existing !== undefined) return existing

  const created = resolveAdapter(name, slots[name].selected)
  instances[name] = created
  return created
}
