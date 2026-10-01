import { expect, it } from 'vitest'
import { findKnownFields } from './ocr-fields'

const known = { legalName: { first: 'Maria', last: 'Santos' }, dateOfBirth: '1988-03-14' }
const line = (text: string) => ({ text, confidence: 0.95 })

it('finds the name despite an OCR slip, the DOB, and labelled dates', () => {
  const fields = findKnownFields(
    [line('NEW YORK STATE'), line('SANTOS, MARlA ELENA'), line('DOB 03/14/1988'), line('ISS 01/10/2025'), line('EXP 03/14/2029')],
    known,
  )
  expect(fields).toEqual(
    expect.arrayContaining([
      { name: 'fullName', value: 'Maria Santos', confidence: 0.95 },
      { name: 'dateOfBirth', value: '1988-03-14', confidence: 0.95 },
      { name: 'issueDate', value: '2025-01-10', confidence: 0.95 },
      { name: 'expiryDate', value: '2029-03-14', confidence: 0.95 },
    ]),
  )
})

it('reports no name when the caregiver is not on the document', () => {
  const fields = findKnownFields([line('JOHN DOE'), line('Completed September 15, 2023')], known)
  expect(fields.find((f) => f.name === 'fullName')).toBeUndefined()
  expect(fields).toContainEqual({ name: 'completionDate', value: '2023-09-15', confidence: 0.95 })
})

it('takes the known name from a line with other words on it', () => {
  const fields = findKnownFields([line('This certifies that Maria Santos has completed')], known)
  expect(fields).toContainEqual({ name: 'fullName', value: 'Maria Santos', confidence: 0.95 })
})

it('labels each date by the text just before it', () => {
  const fields = findKnownFields([line('ISS 01/10/2025 EXP 03/14/2029')], known)
  expect(fields).toEqual([
    { name: 'issueDate', value: '2025-01-10', confidence: 0.95 },
    { name: 'expiryDate', value: '2029-03-14', confidence: 0.95 },
  ])
})

it('matches no line when the legal name has no letters it can compare', () => {
  const fields = findKnownFields([line('Any line at all')], { legalName: { first: '李', last: '王' }, dateOfBirth: null })
  expect(fields).toEqual([])
})
