import { z } from 'zod'

// String literals, never `error: (iss) => …`: the function form receives the raw amount, and a
// W-4 or IT-2104 figure is payroll data (DATA-MODEL.md § Payroll inputs) that is never logged.
const SHAPE_ERROR = 'Enter an amount in dollars, like 1250 or 1250.50.'

const DOLLARS = /^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/

// Split on the point rather than multiplying by 100: 0.29 * 100 is 28.999999999999996.
function toCents(value: string): number {
  const [whole = '', fraction = ''] = value.replace(/[$,]/g, '').split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export const dollarsToCentsSchema = z
  .string()
  .trim()
  .regex(DOLLARS, { error: SHAPE_ERROR })
  .transform(toCents)

export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
