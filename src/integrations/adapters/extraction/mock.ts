import { createHash } from 'node:crypto'
import { extractionInputSchema } from '@/integrations/ports/extraction'
import type {
  ExtractionInput,
  ExtractionPort,
  ExtractionResult,
} from '@/integrations/ports/extraction'
import type { StoragePort } from '@/integrations/ports/storage'
import { RECORDED_EXTRACTIONS } from './fixtures/recorded'

const recordedBySha256 = new Map(
  RECORDED_EXTRACTIONS.map((recorded) => [recorded.sha256, recorded.result]),
)

function unrecognised(): ExtractionResult {
  return { fields: [], text: '', confidence: 0 }
}

export function createMockExtraction(deps: { storage: StoragePort }): ExtractionPort {
  return {
    async extract(input: ExtractionInput): Promise<ExtractionResult> {
      const { agencyId, storageKey } = extractionInputSchema.parse(input)

      // An absent object is a permanent answer from a real vendor, so it is returned, not thrown.
      const stored = await deps.storage.read(agencyId, storageKey)
      if (stored === null) return unrecognised()

      const sha256 = createHash('sha256').update(stored.bytes).digest('hex')
      const recorded = recordedBySha256.get(sha256)
      return recorded === undefined ? unrecognised() : structuredClone(recorded)
    },
  }
}
