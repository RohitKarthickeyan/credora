import { z } from 'zod'

// The password is never trimmed: a trailing space is a character of it. Its 72-byte bcrypt
// limit is enforced where a password is set (src/lib/password.ts), not here.
export const staffCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
})

export type StaffCredentials = z.infer<typeof staffCredentialsSchema>
