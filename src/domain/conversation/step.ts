import type { ReturnReason } from '../documents/review-outcome'
import type { PipelineStage } from '../pipeline/stage'
import type { InstanceStatus } from '../requirements/instance-status'

export const TEXT_INTAKE_FIELDS = ['dateOfBirth', 'sex', 'email', 'address', 'ssn'] as const
export type TextIntakeField = (typeof TEXT_INTAKE_FIELDS)[number]

export const DEMO_DOCUMENTS = ['AIDE_CERTIFICATION', 'TB_TEST', 'PHOTO_ID'] as const
export type DemoDocument = (typeof DEMO_DOCUMENTS)[number]

export type DocumentReturnReason = ReturnReason | 'STAFF_REJECTED'

export type DocumentState =
  | { readonly kind: 'MISSING' }
  | { readonly kind: 'RETURNED'; readonly reason: DocumentReturnReason }
  | { readonly kind: 'UPLOADED' }
  | { readonly kind: 'APPROVED' }

export type ConversationSnapshot = {
  readonly stage: PipelineStage
  readonly paused: boolean
  readonly optedOut: boolean
  readonly unclearCount: number
  readonly missingFields: readonly TextIntakeField[]
  readonly documents: Readonly<Record<DemoDocument, DocumentState>>
}

export type ConversationStep =
  | { readonly kind: 'ASK_FIELD'; readonly field: TextIntakeField }
  | { readonly kind: 'CONFIRM_INTAKE' }
  | { readonly kind: 'AWAIT_SIGNATURE' }
  | { readonly kind: 'REQUEST_DOCUMENT'; readonly document: DemoDocument }
  | { readonly kind: 'FIX_DOCUMENT'; readonly document: DemoDocument; readonly reason: DocumentReturnReason }
  | { readonly kind: 'AWAIT_REVIEW' }
  | { readonly kind: 'CLEARED' }
  | { readonly kind: 'HANDED_OFF' }
  | { readonly kind: 'STOPPED' }

export const MAX_UNCLEAR_REPLIES = 3

export function nextStep(snapshot: ConversationSnapshot): ConversationStep {
  const { stage } = snapshot
  if (stage === 'WITHDRAWN' || snapshot.optedOut) return { kind: 'STOPPED' }
  if (snapshot.paused || snapshot.unclearCount >= MAX_UNCLEAR_REPLIES) return { kind: 'HANDED_OFF' }
  if (stage === 'SYNCING' || stage === 'ACTIVE') return { kind: 'CLEARED' }
  if (stage === 'INVITED' || stage === 'INTAKE') {
    const field = TEXT_INTAKE_FIELDS.find((candidate) => snapshot.missingFields.includes(candidate))
    return field === undefined ? { kind: 'CONFIRM_INTAKE' } : { kind: 'ASK_FIELD', field }
  }
  if (stage === 'SIGNING') return { kind: 'AWAIT_SIGNATURE' }
  for (const document of DEMO_DOCUMENTS) {
    const state = snapshot.documents[document]
    if (state.kind === 'RETURNED') return { kind: 'FIX_DOCUMENT', document, reason: state.reason }
    if (state.kind === 'MISSING') return { kind: 'REQUEST_DOCUMENT', document }
  }
  return { kind: 'AWAIT_REVIEW' }
}

export function documentState(input: {
  readonly status: InstanceStatus
  readonly returnReason: ReturnReason | null
  readonly rejectedByStaff: boolean
}): DocumentState {
  switch (input.status) {
    case 'SATISFIED':
    case 'WAIVED':
      return { kind: 'APPROVED' }
    case 'NOT_STARTED':
    case 'EXPIRED':
      return { kind: 'MISSING' }
    case 'EXCEPTION':
      if (input.returnReason !== null) return { kind: 'RETURNED', reason: input.returnReason }
      if (input.rejectedByStaff) return { kind: 'RETURNED', reason: 'STAFF_REJECTED' }
      return { kind: 'UPLOADED' }
    case 'PENDING':
    case 'IN_REVIEW':
      return { kind: 'UPLOADED' }
  }
}

export function stepKey(step: ConversationStep): string {
  switch (step.kind) {
    case 'ASK_FIELD':
      return `ASK_FIELD:${step.field}`
    case 'REQUEST_DOCUMENT':
    case 'FIX_DOCUMENT':
      return `${step.kind}:${step.document}`
    default:
      return step.kind
  }
}
