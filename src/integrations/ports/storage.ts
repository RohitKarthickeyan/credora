import { z } from 'zod'
import { ULID_PATTERN, ulid } from '@/lib/ulid'

const STORAGE_KINDS = ['upload', 'generated', 'signed', 'clinical'] as const
export type StorageKind = (typeof STORAGE_KINDS)[number]

// Adding a fifth extension or a fourth kind changes a convention nine tasks share: it needs an
// ADR and the matching edit to INTEGRATIONS.md § Storage keys in the same change.
export const STORAGE_CONTENT_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
} as const
type StorageExtension = keyof typeof STORAGE_CONTENT_TYPES

const STORAGE_EXTENSIONS = Object.keys(STORAGE_CONTENT_TYPES) as [
  StorageExtension,
  ...StorageExtension[],
]

export type StorageKey = string

export const storagePlacementSchema = z.object({
  agencyId: z.uuid(),
  caregiverId: z.uuid(),
  kind: z.enum(STORAGE_KINDS),
  extension: z.enum(STORAGE_EXTENSIONS),
})
export type StoragePlacement = z.infer<typeof storagePlacementSchema>

const storageKeyPartsSchema = storagePlacementSchema.extend({
  objectId: z.string().regex(ULID_PATTERN),
})
export type StorageKeyParts = z.infer<typeof storageKeyPartsSchema>

/** `<agencyId>/<caregiverId>/<kind>/<ulid>.<ext>` — ADR-005, INTEGRATIONS.md § Storage keys. */
export function newStorageKey(placement: StoragePlacement): StorageKey {
  const { agencyId, caregiverId, kind, extension } = storagePlacementSchema.parse(placement)

  return `${agencyId}/${caregiverId}/${kind}/${ulid()}.${extension}`
}

export function parseStorageKey(key: string): StorageKeyParts | null {
  const segments = key.split('/')
  if (segments.length !== 4) return null

  const [agencyId, caregiverId, kind, filename] = segments
  if (filename === undefined) return null

  const nameParts = filename.split('.')
  if (nameParts.length !== 2) return null

  const [objectId, extension] = nameParts
  const parsed = storageKeyPartsSchema.safeParse({
    agencyId,
    caregiverId,
    kind,
    objectId,
    extension,
  })
  return parsed.success ? parsed.data : null
}

export const storageKeySchema = z.string().refine((key) => parseStorageKey(key) !== null, {
  error: 'Expected a storage key of the form <agencyId>/<caregiverId>/<kind>/<ulid>.<ext>.',
})

export type StoredObject = { bytes: Uint8Array; contentType: string }

export interface StoragePort {
  write(placement: StoragePlacement, bytes: Uint8Array): Promise<StorageKey>
  read(agencyId: string, key: string): Promise<StoredObject | null>
  delete(agencyId: string, key: string): Promise<boolean>
}
