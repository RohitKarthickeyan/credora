import { DOCUMENT_NAMES } from './replies'
import { type ConversationSnapshot, DEMO_DOCUMENTS, type DocumentState } from './step'

const DOCUMENT_STATUS: Record<DocumentState['kind'], string> = {
  MISSING: 'not sent yet',
  RETURNED: 'needs a new photo',
  UPLOADED: 'waiting for review',
  APPROVED: 'approved',
}

/** The caregiver's progress, one sentence per stage, for the agent to answer status questions. */
export function statusLine(
  snapshot: Pick<ConversationSnapshot, 'stage' | 'missingFields' | 'documents'>,
): string {
  const { stage } = snapshot
  const inIntake = stage === 'INVITED' || stage === 'INTAKE'
  const details = !inIntake
    ? 'complete'
    : snapshot.missingFields.length === 0
      ? 'waiting for confirmation'
      : 'in progress'
  const forms = inIntake ? 'not sent yet' : stage === 'SIGNING' ? 'waiting for signature' : 'signed'
  const documents = DEMO_DOCUMENTS.map(
    (document) => `${DOCUMENT_NAMES[document]}: ${DOCUMENT_STATUS[snapshot.documents[document].kind]}.`,
  )
  const cleared = stage === 'SYNCING' || stage === 'ACTIVE' ? ['Cleared to work.'] : []
  return [`Details: ${details}.`, `Forms: ${forms}.`, ...documents, ...cleared].join(' ')
}
