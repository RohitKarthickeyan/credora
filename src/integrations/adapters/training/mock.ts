import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseTrainingCsv } from './csv'
import { importTrainingInputSchema, listCompletionsInputSchema } from '@/integrations/ports/training'
import type { TrainingPort } from '@/integrations/ports/training'

const CATALOGUE = 'completions.csv'

function readFixture(name: string): Promise<string> {
  return readFile(path.join('src', 'integrations', 'adapters', 'training', 'fixtures', name), 'utf8')
}

export function createMockTraining(): TrainingPort {
  return {
    async importBatch(input) {
      const { sourceRef } = importTrainingInputSchema.parse(input)
      // sourceRef arrives from a job payload; anything but a bare file name would reach into fs.
      if (!/^[a-z0-9][a-z0-9-]*\.csv$/.test(sourceRef)) {
        throw new Error(`training sourceRef must be a fixture file name, got "${sourceRef}"`)
      }
      return { sourceRef, ...parseTrainingCsv(await readFixture(sourceRef)) }
    },

    async listCompletions(input) {
      const { externalCaregiverId, since } = listCompletionsInputSchema.parse(input)
      const { records } = parseTrainingCsv(await readFixture(CATALOGUE))
      return records
        .filter((r) => r.externalCaregiverId === externalCaregiverId && (since === null || r.completedOn >= since))
        .sort((a, b) => a.completedOn.localeCompare(b.completedOn) || a.courseCode.localeCompare(b.courseCode))
    },
  }
}
