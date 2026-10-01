import { describe, expect, it } from 'vitest'
import { documentState, nextStep, type ConversationSnapshot } from './step'

const base: ConversationSnapshot = {
  stage: 'INTAKE',
  paused: false,
  optedOut: false,
  unclearCount: 0,
  missingFields: [],
  documents: { AIDE_CERTIFICATION: { kind: 'MISSING' }, TB_TEST: { kind: 'MISSING' }, PHOTO_ID: { kind: 'MISSING' } },
}

describe('nextStep', () => {
  it('asks for the first missing intake field in order', () => {
    expect(nextStep({ ...base, stage: 'INVITED', missingFields: ['ssn', 'sex'] })).toEqual({ kind: 'ASK_FIELD', field: 'sex' })
  })
  it('asks to confirm once every field is present', () => {
    expect(nextStep(base)).toEqual({ kind: 'CONFIRM_INTAKE' })
  })
  it('waits for the signature while signing', () => {
    expect(nextStep({ ...base, stage: 'SIGNING' })).toEqual({ kind: 'AWAIT_SIGNATURE' })
  })
  it('asks for documents in order, fixing a returned one first', () => {
    const documents = { ...base.documents, AIDE_CERTIFICATION: { kind: 'UPLOADED' as const } }
    expect(nextStep({ ...base, stage: 'DOCUMENT_REVIEW', documents })).toEqual({ kind: 'REQUEST_DOCUMENT', document: 'TB_TEST' })
    const returned = { ...documents, AIDE_CERTIFICATION: { kind: 'RETURNED' as const, reason: 'EXPIRED' as const } }
    expect(nextStep({ ...base, stage: 'DOCUMENT_REVIEW', documents: returned })).toEqual({ kind: 'FIX_DOCUMENT', document: 'AIDE_CERTIFICATION', reason: 'EXPIRED' })
  })
  it('waits for review once everything is uploaded', () => {
    const documents = { AIDE_CERTIFICATION: { kind: 'APPROVED' as const }, TB_TEST: { kind: 'UPLOADED' as const }, PHOTO_ID: { kind: 'UPLOADED' as const } }
    expect(nextStep({ ...base, stage: 'VERIFICATION', documents })).toEqual({ kind: 'AWAIT_REVIEW' })
  })
  it('is cleared once ready for AlayaCare', () => {
    expect(nextStep({ ...base, stage: 'SYNCING' })).toEqual({ kind: 'CLEARED' })
  })
  it('hands off when paused or after three unclear replies, and stops when withdrawn or opted out', () => {
    expect(nextStep({ ...base, paused: true })).toEqual({ kind: 'HANDED_OFF' })
    expect(nextStep({ ...base, unclearCount: 3 })).toEqual({ kind: 'HANDED_OFF' })
    expect(nextStep({ ...base, stage: 'WITHDRAWN' })).toEqual({ kind: 'STOPPED' })
    expect(nextStep({ ...base, optedOut: true, paused: true })).toEqual({ kind: 'STOPPED' })
  })
})

describe('documentState', () => {
  it('reads a returned or staff-returned upload as returned, and a staff-bound one as uploaded', () => {
    expect(documentState({ status: 'EXCEPTION', returnReason: 'UNREADABLE', staffDecision: null })).toEqual({ kind: 'RETURNED', reason: 'UNREADABLE' })
    expect(documentState({ status: 'EXCEPTION', returnReason: null, staffDecision: 'REJECTED' })).toEqual({ kind: 'RETURNED', reason: 'STAFF_WRONG_DOCUMENT' })
    expect(documentState({ status: 'EXCEPTION', returnReason: null, staffDecision: 'REUPLOAD_REQUESTED' })).toEqual({ kind: 'RETURNED', reason: 'STAFF_UNCLEAR_PHOTO' })
    expect(documentState({ status: 'EXCEPTION', returnReason: null, staffDecision: null })).toEqual({ kind: 'UPLOADED' })
    expect(documentState({ status: 'NOT_STARTED', returnReason: null, staffDecision: null })).toEqual({ kind: 'MISSING' })
    expect(documentState({ status: 'SATISFIED', returnReason: null, staffDecision: 'ACCEPTED' })).toEqual({ kind: 'APPROVED' })
  })
})
