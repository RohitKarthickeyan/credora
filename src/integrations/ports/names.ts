import type { AlayaCarePort } from './alayacare'
import type { BackgroundCheckPort } from './backgroundCheck'
import type { EsignPort } from './esign'
import type { ExtractionPort } from './extraction'
import type { JudgePort } from './judge'
import type { MessagingPort } from './messaging'
import type { StoragePort } from './storage'
import type { TrainingPort } from './training'

// Deliberately no ports/index.ts barrel: it would be one more shared line for every adapter
// task to append to. Import @/integrations/ports/<port> directly.
export const PORT_NAMES = [
  'messaging',
  'esign',
  'extraction',
  'judge',
  'backgroundCheck',
  'alayacare',
  'training',
  'storage',
] as const
export type PortName = (typeof PORT_NAMES)[number]

export type Ports = {
  messaging: MessagingPort
  esign: EsignPort
  extraction: ExtractionPort
  judge: JudgePort
  backgroundCheck: BackgroundCheckPort
  alayacare: AlayaCarePort
  training: TrainingPort
  storage: StoragePort
}
