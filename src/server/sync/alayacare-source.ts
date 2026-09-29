import 'server-only'
import type { StoredCredential } from '@/db/repositories/credentials'
import type { SyncSourceCredential } from '@/domain/sync/alayacare-mapping'
import { parseStorageKey } from '@/integrations/ports/storage'

// Only a personnel upload is sent; a clinic result stays in Credora until the product decides
// otherwise.
function personnelDocumentKey(key: string | null): string | null {
  return key !== null && parseStorageKey(key)?.kind === 'upload' ? key : null
}

/** The sync's view of a stored credential. Only a personnel upload's key is carried as documentKey;
 *  a clinical file, a signed or generated key, or an unparseable key becomes null (T-070, OPEN-QUESTIONS 102). */
export function toSyncSourceCredential(credential: StoredCredential): SyncSourceCredential {
  return {
    credentialId: credential.id,
    type: credential.type,
    number: credential.number,
    issuer: credential.issuer,
    issuedOn: credential.issuedOn,
    expiresOn: credential.expiresOn,
    documentKey: personnelDocumentKey(credential.uploadedDocumentKey),
  }
}
