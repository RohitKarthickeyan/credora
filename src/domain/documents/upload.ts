import type { InstanceStatus } from '@/domain/requirements/instance-status'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export const UPLOAD_FORMATS = ['pdf', 'jpg', 'png', 'heic'] as const
type UploadFormat = (typeof UPLOAD_FORMATS)[number]

type UploadBytesCheck =
  | { readonly ok: true; readonly format: UploadFormat }
  | { readonly ok: false; readonly refusal: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_FORMAT' }

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]
const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to))
}

function sniffFormat(bytes: Uint8Array): UploadFormat | null {
  if (startsWith(bytes, PDF)) return 'pdf'
  if (startsWith(bytes, JPEG)) return 'jpg'
  if (startsWith(bytes, PNG)) return 'png'
  if (ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.includes(ascii(bytes, 8, 12))) return 'heic'
  return null
}

// The browser's declared type is never consulted: the format is what the bytes are.
export function checkUploadBytes(bytes: Uint8Array): UploadBytesCheck {
  if (bytes.length === 0) return { ok: false, refusal: 'EMPTY' }
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, refusal: 'TOO_LARGE' }

  const format = sniffFormat(bytes)
  return format === null ? { ok: false, refusal: 'UNSUPPORTED_FORMAT' } : { ok: true, format }
}

// Fail-closed (ADR-068): an evidence key not listed as PERSONNEL is stored as clinical.
const UPLOAD_EVIDENCE_CLASSES: Readonly<Record<string, 'CLINICAL' | 'PERSONNEL'>> = {
  HHA_CERTIFICATE: 'PERSONNEL',
  PCA_CERTIFICATE: 'PERSONNEL',
  PHYSICAL_EXAM_REPORT: 'CLINICAL',
  TB_PPD_RESULT: 'CLINICAL',
  TB_CHEST_XRAY: 'CLINICAL',
  IMMUNIZATION_RECORD: 'CLINICAL',
}

export function isClinicalUpload(evidenceKey: string): boolean {
  return UPLOAD_EVIDENCE_CLASSES[evidenceKey] !== 'PERSONNEL'
}

export const UPLOADABLE_STATUSES: readonly InstanceStatus[] = [
  'NOT_STARTED',
  'PENDING',
  'EXCEPTION',
  'EXPIRED',
]

export type DocumentRequest = {
  readonly instanceId: string
  readonly templateKey: string
  readonly name: string
  readonly status: InstanceStatus
  readonly options: readonly { readonly evidenceKey: string; readonly label: string }[]
  readonly uploadCount: number
}

export type UploadRefusal = 'NOT_ACCEPTED' | 'NOT_OPEN'

export function uploadRefusal(request: DocumentRequest, evidenceKey: string): UploadRefusal | null {
  if (!UPLOADABLE_STATUSES.includes(request.status)) return 'NOT_OPEN'
  if (!request.options.some((option) => option.evidenceKey === evidenceKey)) return 'NOT_ACCEPTED'
  return null
}
