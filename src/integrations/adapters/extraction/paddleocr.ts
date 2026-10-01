import { z } from 'zod'
import { VendorUnavailableError } from '@/integrations/ports/errors'
import { extractionInputSchema, type ExtractionPort, type ExtractionResult } from '@/integrations/ports/extraction'
import type { StoragePort } from '@/integrations/ports/storage'
import { env } from '@/lib/env'

const ocrResponseSchema = z.object({
  lines: z.array(z.object({ text: z.string(), confidence: z.number().min(0).max(1) })),
})

const UNREADABLE: ExtractionResult = { fields: [], text: '', confidence: 0 }

/**
 * Plain text and line confidences from the local PaddleOCR service (`services/ocr/`). Fields are
 * left empty: the extraction job finds them in the text against intake (`findKnownFields`).
 */
export function createPaddleOcrExtraction(deps: { storage: StoragePort }): ExtractionPort {
  return {
    async extract(input) {
      const { agencyId, storageKey } = extractionInputSchema.parse(input)
      const stored = await deps.storage.read(agencyId, storageKey)
      if (stored === null) return UNREADABLE

      let response: Response
      try {
        response = await fetch(new URL('/ocr', env.OCR_URL), {
          method: 'POST',
          body: Buffer.from(stored.bytes),
          signal: AbortSignal.timeout(120_000),
        })
      } catch (error) {
        throw new VendorUnavailableError('extraction', `The OCR service did not answer: ${String(error)}`)
      }
      // 415: bytes that are neither a PDF nor an image the service reads, which no retry fixes.
      if (response.status === 415) return UNREADABLE
      if (response.status === 429 || response.status >= 500) {
        throw new VendorUnavailableError('extraction', `The OCR service answered ${response.status}`)
      }
      if (!response.ok) throw new Error(`The OCR service answered ${response.status}: ${await response.text()}`)

      const { lines } = ocrResponseSchema.parse(await response.json())
      return {
        fields: [],
        text: lines.map((line) => line.text).join('\n'),
        confidence: lines.length === 0 ? 0 : lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length,
      }
    },
  }
}
