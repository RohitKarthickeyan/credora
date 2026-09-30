import { expect, it } from 'vitest'
import { passesOutputCheck } from './output-check'

const origins = ['http://localhost:3000', 'http://localhost:3001']

it('refuses nine-digit numbers, foreign links and overlong replies', () => {
  expect(passesOutputCheck('Your first shift is Monday.', origins)).toBe(true)
  expect(passesOutputCheck('Sign at http://localhost:3001/s/abc', origins)).toBe(true)
  expect(passesOutputCheck('Your SSN is 123-45-6789', origins)).toBe(false)
  expect(passesOutputCheck('See https://evil.example/x', origins)).toBe(false)
  expect(passesOutputCheck('a'.repeat(481), origins)).toBe(false)
})
