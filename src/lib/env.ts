import 'server-only'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  // String-literal error, never `error: (iss) => …`: the function form receives `iss.input`,
  // which here is the encryption key itself, and this file interpolates the prettified error
  // into a throw at module load — the first thing in a crash log.
  FIELD_ENCRYPTION_KEY: z
    .base64()
    .refine((value) => Buffer.from(value, 'base64').byteLength === 32, {
      error: 'FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits).',
    }),
  STORAGE_ROOT: z.string().min(1).default('./storage'),
  // Shape only: the set of valid adapter names is the registry's slot table (INTEGRATIONS.md
  // Rule 3), so an unknown name fails at boot via assertEveryPortResolves() (src/instrumentation.ts).
  MESSAGING_ADAPTER: z.string().min(1).default('mock'),
  ESIGN_ADAPTER: z.string().min(1).default('mock'),
  EXTRACTION_ADAPTER: z.string().min(1).default('mock'),
  JUDGE_ADAPTER: z.string().min(1).default('mock'),
  BGCHECK_ADAPTER: z.string().min(1).default('mock'),
  ALAYACARE_ADAPTER: z.string().min(1).default('mock'),
  // Not z.httpUrl(): it demands a dotted domain, so it rejects http://localhost:4010 itself.
  ALAYACARE_BASE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:4010'),
  TRAINING_ADAPTER: z.string().min(1).default('mock'),
  STORAGE_ADAPTER: z.string().min(1).default('local'),
  AGENT_ADAPTER: z.string().min(1).default('mock'),
  // Checked by the judge's `claude` factory, not by a refine here, so no adapter name lives in
  // this file.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32, { error: 'SESSION_SECRET must be at least 32 characters.' }),
  // The absolute origin links to this app are built on; set it in any deployed environment.
  APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  // The e-sign service's public origin; its signing links are the one other URL a reply may carry.
  DOCUSEAL_URL: z.url({ protocol: /^https?$/ }).optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`)
}

export const env = parsed.data
