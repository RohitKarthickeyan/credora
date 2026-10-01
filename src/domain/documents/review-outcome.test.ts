import { describe, expect, it } from 'vitest'
import type { IdentityOutcome } from '@/domain/identity/match'
import type { JudgeStepOutcome } from './judge-review'
import { reviewOutcome } from './review-outcome'

const requirement = { manualOnly: false, manualOnlyReason: null }
const PASS: JudgeStepOutcome = { kind: 'PASS' }

function outcome(input: {
  confidence?: number
  fullName?: IdentityOutcome
  dateOfBirth?: IdentityOutcome
  judge?: JudgeStepOutcome
}) {
  const fullName = input.fullName ?? 'AGREES'
  const dateOfBirth = input.dateOfBirth ?? 'AGREES'
  return reviewOutcome({
    requirement,
    extraction: { confidence: input.confidence ?? 0.95, fields: {} },
    identity: {
      matched: fullName === 'AGREES' && dateOfBirth === 'AGREES',
      findings: [
        { field: 'fullName', outcome: fullName },
        { field: 'dateOfBirth', outcome: dateOfBirth },
      ],
    },
    judge: input.judge ?? PASS,
  })
}

describe('reviewOutcome', () => {
  it('returns an unreadable document before any other check', () => {
    expect(outcome({ confidence: 0.3, fullName: 'DIFFERS', judge: { kind: 'STAFF', reasons: ['EXPIRED'] } })).toEqual({
      kind: 'RETURN',
      reason: 'UNREADABLE',
    })
  })
  it('returns an expired document', () => {
    expect(outcome({ judge: { kind: 'STAFF', reasons: ['EXPIRED'] }, fullName: 'DIFFERS' })).toEqual({
      kind: 'RETURN',
      reason: 'EXPIRED',
    })
  })
  it('returns a document whose name differs or cannot be read', () => {
    expect(outcome({ fullName: 'DIFFERS', dateOfBirth: 'DIFFERS' })).toEqual({ kind: 'RETURN', reason: 'NAME_NOT_FOUND' })
    expect(outcome({ fullName: 'UNREADABLE' })).toEqual({ kind: 'RETURN', reason: 'NAME_NOT_FOUND' })
  })
  it('returns a document that does not carry the caregiver\'s name', () => {
    expect(outcome({ fullName: 'NOT_PRINTED' })).toEqual({ kind: 'RETURN', reason: 'NAME_NOT_FOUND' })
  })
  it('returns a document whose date of birth differs', () => {
    expect(outcome({ dateOfBirth: 'DIFFERS' })).toEqual({ kind: 'RETURN', reason: 'DOB_DIFFERS' })
  })
  it('sends everything else to staff, with what failed', () => {
    expect(outcome({})).toEqual({ kind: 'STAFF', reasons: [] })
    expect(outcome({ judge: { kind: 'STAFF', reasons: ['VERDICT_UNCERTAIN'] } })).toEqual({
      kind: 'STAFF',
      reasons: ['JUDGE_NOT_PASSED'],
    })
  })
})
