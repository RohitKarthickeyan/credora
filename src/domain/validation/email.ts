import { z } from 'zod'

// Lower-cased on capture so the sign-in lookup and the per-agency uniqueness check can compare
// addresses exactly.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }))
