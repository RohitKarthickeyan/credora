import type { ConversationStep, DemoDocument, DocumentReturnReason, TextIntakeField } from './step'

export type IntakeReadBack = {
  readonly legalName: string
  readonly dateOfBirth: string
  readonly sex: string
  readonly email: string
  readonly address: string
  readonly ssnLast4: string
}

export type ReplyContext = {
  readonly firstName: string
  readonly agencyName: string
  readonly signingUrl: string | null
  readonly readBack: IntakeReadBack | null
}

export type ConversationNotice =
  | { readonly kind: 'WELCOME' }
  | { readonly kind: 'SIGNED' }
  | { readonly kind: 'APPROVED'; readonly document: DemoDocument }

export const DOCUMENT_NAMES: Record<DemoDocument, string> = {
  AIDE_CERTIFICATION: 'HHA certificate',
  TB_TEST: 'TB test result',
  PHOTO_ID: "driver's license",
}

const FIELD_PROMPTS: Record<TextIntakeField, string> = {
  dateOfBirth: "What's your date of birth? (for example 03/14/1988)",
  sex: 'What sex is shown on your ID: F, M or X?',
  email: "What's your email address?",
  address: "What's your home address? Street, city, state and ZIP.",
  ssn: "What's your Social Security number? It's stored encrypted and only the last four digits are ever shown.",
}

const RETURN_REASONS: Record<DocumentReturnReason, (document: string) => string> = {
  UNREADABLE: () => "we couldn't read it. Please send a clearer photo in good light, with the whole document in frame",
  EXPIRED: () => 'it has expired. Please send a current one',
  NAME_NOT_FOUND: () => "we couldn't find your name on it. Please send one issued in your legal name",
  DOB_DIFFERS: () => "the date of birth on it doesn't match yours. Please check it's your document",
  STAFF_WRONG_DOCUMENT: (document) => `our team says this isn't the right document. Please send a photo of your ${document}`,
  STAFF_UNCLEAR_PHOTO: () => "our team couldn't read it clearly. Please send a clearer photo",
}

export const HANDOFF_REPLY = "Thanks. I've passed this to the team and someone will follow up with you soon."
export const WRONG_TIME_FOR_PHOTO = "Thanks! I'll ask for your documents after you've signed your forms."
export const FAILURE_REPLY = 'Sorry, something went wrong. Someone from the team will follow up.'

export function promptFor(step: ConversationStep, context: ReplyContext): string {
  switch (step.kind) {
    case 'ASK_FIELD':
      return FIELD_PROMPTS[step.field]
    case 'CONFIRM_INTAKE': {
      const r = context.readBack
      if (r === null) throw new Error('CONFIRM_INTAKE is reached only once every intake field is present.')
      return [
        "Here's what I have:",
        `Name: ${r.legalName}`,
        `Date of birth: ${r.dateOfBirth}`,
        `Sex: ${r.sex}`,
        `Email: ${r.email}`,
        `Address: ${r.address}`,
        `SSN: ending ${r.ssnLast4}`,
        'Reply YES if this is right, or tell me what to change.',
      ].join('\n')
    }
    case 'AWAIT_SIGNATURE':
      return context.signingUrl === null
        ? "I'm preparing your forms to sign. I'll text you the link in a moment."
        : `Please review and sign your forms here: ${context.signingUrl}`
    case 'REQUEST_DOCUMENT':
      return `Please send a photo of your ${DOCUMENT_NAMES[step.document]}.`
    case 'FIX_DOCUMENT':
      return `About your ${DOCUMENT_NAMES[step.document]}: ${RETURN_REASONS[step.reason](DOCUMENT_NAMES[step.document])}.`
    case 'AWAIT_REVIEW':
      return "You've sent everything we need. Our team is reviewing it and I'll text you with any news."
    case 'CLEARED':
      return `You're cleared to work with ${context.agencyName}! The team will be in touch about your first shift.`
    case 'HANDED_OFF':
      return HANDOFF_REPLY
    case 'STOPPED':
      return ''
  }
}

export function noticeFor(notice: ConversationNotice, context: ReplyContext): string {
  switch (notice.kind) {
    case 'WELCOME':
      return `Hi ${context.firstName}, this is ${context.agencyName}. I'll help you finish your onboarding by text. You can ask me a question at any time.`
    case 'SIGNED':
      return 'Thanks for signing!'
    case 'APPROVED':
      return `Good news: your ${DOCUMENT_NAMES[notice.document]} was approved.`
  }
}
