import type { PipelineStage } from '@/domain/pipeline/stage'
import { DOCUMENT_KEYS } from '@/domain/requirements/vocabulary'

// Mirrors the Prisma enum AlayaCareSyncStatus; keep the two in step.
export const ALAYACARE_SYNC_STATUSES = ['RUNNING', 'SYNCED', 'CONFLICT', 'REJECTED'] as const
export type AlayaCareSyncStatus = (typeof ALAYACARE_SYNC_STATUSES)[number]

type SyncStageAction = 'SYNC' | 'SKIP' | 'REFUSE'

// ACTIVE syncs because it is a redelivery after success, harmless since every write is
// idempotent; WITHDRAWN ends with no side effects (ADR-079); anything earlier was never signed off.
export function syncStageAction(stage: PipelineStage): SyncStageAction {
  if (stage === 'SYNCING' || stage === 'ACTIVE') return 'SYNC'
  if (stage === 'WITHDRAWN') return 'SKIP'
  return 'REFUSE'
}

export type AlayaCareProfileSource = {
  readonly legalFirstName: string | null
  readonly legalLastName: string | null
  readonly dateOfBirth: string | null
  readonly email: string | null
  readonly mobilePhone: string | null
}

export type AlayaCareProfileFields = {
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly email: string | null
  readonly phone: string | null
  readonly startDate: null
}

type RequiredProfileField = 'legalFirstName' | 'legalLastName' | 'dateOfBirth'

type AlayaCareProfileProjection =
  | { readonly ok: true; readonly profile: AlayaCareProfileFields }
  | { readonly ok: false; readonly missing: readonly RequiredProfileField[] }

const REQUIRED_PROFILE_FIELDS: readonly RequiredProfileField[] = ['legalFirstName', 'legalLastName', 'dateOfBirth']

// Credora holds no hire date, so startDate is null (ADR-118); phone is the mobile number.
export function projectAlayaCareProfile(source: AlayaCareProfileSource): AlayaCareProfileProjection {
  const missing = REQUIRED_PROFILE_FIELDS.filter((field) => (source[field] ?? '').trim() === '')
  const { legalFirstName, legalLastName, dateOfBirth } = source
  if (legalFirstName === null || legalLastName === null || dateOfBirth === null || missing.length > 0) {
    return { ok: false, missing }
  }
  return {
    ok: true,
    profile: {
      firstName: legalFirstName,
      lastName: legalLastName,
      dateOfBirth,
      email: source.email,
      phone: source.mobilePhone,
      startDate: null,
    },
  }
}

// Written out, never derived by exclusion, so a document key added later does not reach AlayaCare
// by accident. Left out: the W-4, IT-2104, I-9 Section 1 and direct deposit election, which print
// (or can print) a value the record holds encrypted, and the Hep B and flu statements, whose
// answers are held back from AlayaCare.
/** The signed documents attached to the AlayaCare profile, by document key (an allowlist). */
const ALAYACARE_SIGNED_DOCUMENTS: readonly string[] = [
  DOCUMENT_KEYS.CHRC_102,
  DOCUMENT_KEYS.CHRC_FINGERPRINT_QUESTIONNAIRE,
  DOCUMENT_KEYS.NY_WAGE_NOTICE,
  DOCUMENT_KEYS.EMPLOYMENT_APPLICATION,
  DOCUMENT_KEYS.OFFER_LETTER,
  DOCUMENT_KEYS.HHA_JOB_DESCRIPTION,
  DOCUMENT_KEYS.PCA_JOB_DESCRIPTION,
  DOCUMENT_KEYS.WORKER_AGREEMENT,
  DOCUMENT_KEYS.PHI_ACKNOWLEDGEMENT,
  DOCUMENT_KEYS.FCRA_DISCLOSURE,
]

export type SignedDocumentSource = {
  readonly id: string
  readonly templateKey: string
  readonly signedPdfKey: string
}

export type AlayaCareDocumentUpload = {
  readonly signedDocumentId: string
  readonly templateKey: string
  readonly storageKey: string
  readonly filename: string
}

// An e-signed copy is always a PDF.
export function signedDocumentsForAlayaCare(
  signed: readonly SignedDocumentSource[],
): readonly AlayaCareDocumentUpload[] {
  return signed
    .filter((document) => ALAYACARE_SIGNED_DOCUMENTS.includes(document.templateKey))
    .map((document) => ({
      signedDocumentId: document.id,
      templateKey: document.templateKey,
      storageKey: document.signedPdfKey,
      filename: `${document.templateKey}.pdf`,
    }))
}
