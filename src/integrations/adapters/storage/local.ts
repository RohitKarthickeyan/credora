import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STORAGE_CONTENT_TYPES, newStorageKey, parseStorageKey } from '@/integrations/ports/storage'
import type {
  StorageKey,
  StoragePlacement,
  StoragePort,
  StoredObject,
} from '@/integrations/ports/storage'
import { env } from '@/lib/env'

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENOENT'
}

/**
 * The only file in the product that knows a filesystem exists. Tenancy here is the key's own
 * first segment and the prefix check below — not an access control list; real isolation is a
 * deployment property of whatever replaces this adapter (ADR-005, PLAN § Design 5).
 */
export function createLocalDiskStorage(root: string = env.STORAGE_ROOT): StoragePort {
  const absoluteRoot = path.resolve(root)

  function locate(agencyId: string, key: string): { file: string; contentType: string } {
    const parts = parseStorageKey(key)
    if (parts === null) {
      throw new Error(`Malformed storage key: ${JSON.stringify(key)}`)
    }
    if (parts.agencyId !== agencyId) {
      throw new Error(`Storage key belongs to another agency than ${agencyId}.`)
    }

    const file = path.resolve(
      absoluteRoot,
      parts.agencyId,
      parts.caregiverId,
      parts.kind,
      `${parts.objectId}.${parts.extension}`,
    )
    // Unreachable while parseStorageKey is correct, and kept for exactly that reason: a future
    // loosening of the parser fails closed here rather than escaping the root silently.
    if (!file.startsWith(absoluteRoot + path.sep)) {
      throw new Error('Resolved storage path escapes the storage root.')
    }

    return { file, contentType: STORAGE_CONTENT_TYPES[parts.extension] }
  }

  return {
    async write(placement: StoragePlacement, bytes: Uint8Array): Promise<StorageKey> {
      const key = newStorageKey(placement)
      const { file } = locate(placement.agencyId, key)

      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)

      return key
    },

    async read(agencyId: string, key: string): Promise<StoredObject | null> {
      const { file, contentType } = locate(agencyId, key)

      try {
        return { bytes: await readFile(file), contentType }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async delete(agencyId: string, key: string): Promise<boolean> {
      const { file } = locate(agencyId, key)

      try {
        await unlink(file)
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    },
  }
}
