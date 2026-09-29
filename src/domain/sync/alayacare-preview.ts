import {
  type AlayaCareMapping,
  type AlayaCareProjection,
  type AlayaCareSyncSource,
  type CredentialType,
  type UnresolvedCustomField,
  projectAlayaCareFields,
} from './alayacare-mapping'
import {
  type AlayaCareProfileSource,
  type SignedDocumentSource,
  projectAlayaCareProfile,
  signedDocumentsForAlayaCare,
} from './alayacare-sync'

type AlayaCarePreviewSource = AlayaCareSyncSource & {
  readonly profile: AlayaCareProfileSource
  readonly signedDocuments: readonly SignedDocumentSource[]
}

export type AlayaCarePreviewCredential = {
  readonly credentialId: string
  readonly type: CredentialType
  readonly code: string
  readonly number: string | null
  readonly issuer: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  readonly documentAttached: boolean
}

export type AlayaCarePreviewDocument = { readonly id: string; readonly templateKey: string; readonly sent: boolean }

export type AlayaCarePreview = {
  readonly profile: ReturnType<typeof projectAlayaCareProfile>
  readonly credentials: readonly AlayaCarePreviewCredential[]
  readonly unmappedCredentialTypes: readonly CredentialType[]
  readonly customFields: AlayaCareProjection['customFields']
  readonly unresolvedCustomFields: readonly UnresolvedCustomField[]
  readonly documents: readonly AlayaCarePreviewDocument[]
}

// Composed from the sync's own projections, so the preview cannot drift from what is sent (ADR-136).
export function previewAlayaCareSync(mapping: AlayaCareMapping, source: AlayaCarePreviewSource): AlayaCarePreview {
  const projection = projectAlayaCareFields(mapping, source)
  const mapped = new Map(projection.credentials.map((credential) => [credential.credentialId, credential]))
  const sent = new Set(signedDocumentsForAlayaCare(source.signedDocuments).map((upload) => upload.signedDocumentId))

  return {
    profile: projectAlayaCareProfile(source.profile),
    credentials: source.credentials.flatMap(({ credentialId, type }) => {
      const credential = mapped.get(credentialId)
      if (credential === undefined) return []
      const { documentKey, ...shown } = credential
      return [{ type, ...shown, documentAttached: documentKey !== null }]
    }),
    unmappedCredentialTypes: projection.unmappedCredentialTypes,
    customFields: projection.customFields,
    unresolvedCustomFields: projection.unresolvedCustomFields,
    documents: source.signedDocuments.map((document) => ({
      id: document.id,
      templateKey: document.templateKey,
      sent: sent.has(document.id),
    })),
  }
}
