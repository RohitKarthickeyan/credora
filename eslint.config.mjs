import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const prismaOutsideDb = {
  group: [
    '@prisma/client', '@prisma/client/*', '.prisma/client', '.prisma/client/*',
    '@/db/generated', '@/db/restricted/connection',
  ],
  message:
    'Prisma is imported only inside src/db/ (CONVENTIONS.md § Database). Call a repository ' +
    'from src/db/repositories/ instead; every repository function takes agencyId first. ' +
    'Medical and EEOC models are reached only through src/db/restricted/ (DATA-MODEL.md, ADR-002). ' +
    'The generated client under @/db/generated and the connection in @/db/restricted/connection ' +
    'are internal to src/db/ for the same reason.',
};

const restrictedModels = {
  group: [
    '@/db/generated/client',
    '@/db/generated/models/MedicalFile', '@/db/generated/models/EeocRecord',
    '@/db/generated/models/MedicalAnswer', '@/db/generated/models/MedicalScreeningResult',
    '**/generated/client',
    '**/generated/models/MedicalFile', '**/generated/models/EeocRecord',
    '**/generated/models/MedicalAnswer', '**/generated/models/MedicalScreeningResult',
  ],
  message:
    'Medical and EEOC models live in their own Postgres schemas and are reached only through ' +
    'src/db/restricted/ (DATA-MODEL.md § Postgres schemas, ADR-002). Call an accessor from ' +
    'src/db/restricted/medical.ts or eeoc.ts; it is agency-scoped and audited. For core models, ' +
    'import the narrowed client from @/db/prisma and the model type from ' +
    '@/db/generated/models/<Model> — never the client or the models barrel, both of which ' +
    'expose every restricted model.',
};

const cryptoOutsideMapping = {
  // A regex, not a `group`: `group` uses gitignore semantics and would not catch the relative
  // form './crypto' that a sibling file inside src/db/ would write. It does not match
  // 'node:crypto', which is the form src/db/crypto.ts itself imports.
  regex: '(^|/)db/crypto$|^\\.\\.?/crypto$',
  message:
    'Field encryption is called from src/db/mapping/ and nowhere else (DATA-MODEL.md ' +
    '§ Field-level encryption: "Repositories call it; nothing else does"). Build the columns ' +
    'with toSsnColumns / toBankAccountNumberColumns / toBankRoutingNumberColumns / ' +
    'toWorkAuthorizationNumberColumns from @/db/mapping/sensitive. The ordinary read path ' +
    'does not decrypt: it selects the *Last4 column and leaves the envelope sealed. The one ' +
    'reveal door is revealSensitiveField, inside the audit transaction ' +
    '(SECURITY.md § Field masking).',
};

const adapterOutsideRegistry = {
  // A regex, not a `group`: `group` uses gitignore semantics (ADR-022), so it would not catch
  // the relative forms. Three alternatives: the aliased path from anywhere; `../adapters/...`
  // from a file directly under src/integrations/; and `../<port>/...`, which is how one
  // adapter directory would reach into a sibling port's.
  regex:
    '(^|/)integrations/adapters/' +
    '|^\\.\\.?/adapters/' +
    '|^\\.\\./(messaging|esign|extraction|judge|backgroundCheck|alayacare|training|storage)/',
  message:
    'Adapters are reached only through the registry (INTEGRATIONS.md Rule 3: "nothing outside ' +
    'src/integrations imports an adapter directly"). Call getPort(\'<port>\') from ' +
    '@/integrations/registry at a composition boundary and pass the port down as an argument; ' +
    'a use case takes its ports as parameters. To add or swap an implementation, register a ' +
    'factory in that port\'s slot in src/integrations/registry.ts and set its *_ADAPTER variable.',
};

const anthropicSdk = {
  // A regex, not a `group`, so a subpath such as '@anthropic-ai/sdk/helpers/zod' is caught too.
  regex: '^@anthropic-ai/sdk(/|$)',
  message:
    'Only src/integrations/adapters/judge/claude.ts calls a model (AGENTIC-TASKS.md: nothing in ' +
    'src/ may call an LLM unless listed there). Call getPort(\'judge\') instead.',
};

// The three patterns that apply everywhere inside src/db/, shared by the two blocks below.
const dbInternals = [
  restrictedModels,
  // `group` patterns use gitignore semantics, so a bare '@/db/generated/models' entry
  // would match the whole directory and block the per-model imports repositories need.
  { regex: '(^|/)generated/models$', message: restrictedModels.message },
  { regex: '(^|/)connection$', message: restrictedModels.message },
];

const domainMessage =
  'src/domain is the bottom layer: pure rules, no I/O (ARCHITECTURE.md § Layers). It may ' +
  'import other src/domain modules, zod and date-fns — nothing else in src/, and no ' +
  'framework. Do the I/O in src/server (a use case) or src/db (a repository) and pass the ' +
  'result into the rule as a plain argument. If that feels wrong, the rule is not pure and ' +
  'belongs in src/server.';

const serverMessage =
  'src/server is below src/app and src/ui (ARCHITECTURE.md § Layers). An arrow may only ' +
  'point downward. Return data from the use case and let the route or component render it.';

const appMessage =
  'src/app may import server, domain and ui — never db (ARCHITECTURE.md § Layers). Caregiver ' +
  'data reaches a page or a Server Action through a use case in src/server, which is the one ' +
  'place the policy check cannot be bypassed (SECURITY.md § Authorization). A page or action ' +
  'that calls a repository directly skips it.';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [prismaOutsideDb, cryptoOutsideMapping, adapterOutsideRegistry, anthropicSdk],
      }],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          {
            group: [
              '@/app', '@/app/*', '@/server', '@/server/*', '@/db', '@/db/*',
              '@/integrations', '@/integrations/*', '@/ui', '@/ui/*', '@/lib', '@/lib/*',
            ],
            message: domainMessage,
          },
          {
            regex: '^\\.\\.(/\\.\\.)*/(app|server|db|integrations|ui|lib)(/|$)',
            message: domainMessage,
          },
          {
            group: ['next', 'next/*', 'react', 'react-dom', 'server-only'],
            message: domainMessage,
          },
          anthropicSdk,
        ],
      }],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          { group: ['@/app', '@/app/*', '@/ui', '@/ui/*'], message: serverMessage },
          { regex: '^\\.\\.(/\\.\\.)*/(app|ui)(/|$)', message: serverMessage },
          adapterOutsideRegistry,
          anthropicSdk,
        ],
      }],
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          {
            group: [
              '@/app', '@/app/*', '@/server', '@/server/*', '@/db', '@/db/*',
              '@/domain', '@/domain/*', '@/integrations', '@/integrations/*',
            ],
            message:
              'Primitives in src/ui know nothing about caregivers (CONVENTIONS.md § UI). ' +
              'Take the value as a prop and let the caller in src/app do the domain work.',
          },
          anthropicSdk,
        ],
      }],
    },
  },
  {
    files: ['src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          {
            group: [
              '@/app', '@/app/*', '@/server', '@/server/*', '@/db', '@/db/*',
              '@/domain', '@/domain/*', '@/integrations', '@/integrations/*', '@/ui', '@/ui/*',
            ],
            message:
              'src/lib is genuinely generic helpers with no domain knowledge ' +
              '(ARCHITECTURE.md § Layers). If this helper needs a caregiver, a requirement or ' +
              'a port, it belongs in src/domain or src/server, not here.',
          },
          anthropicSdk,
        ],
      }],
    },
  },
  {
    files: ['src/db/**/*.ts'],
    ignores: ['src/db/restricted/**', 'src/db/prisma.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...dbInternals, adapterOutsideRegistry, anthropicSdk] }],
    },
  },
  // Inside src/db/, the encryption boundary is narrower than the directory: only the mapping
  // layer may reach it. A later reveal path adds its directory to
  // `ignores` here, which is the visibility a decrypt call site deserves.
  {
    files: ['src/db/**/*.ts'],
    ignores: [
      'src/db/restricted/**',
      'src/db/prisma.ts',
      'src/db/mapping/**',
      'src/db/crypto.ts',
      'src/db/repositories/sensitive-field.ts',
      'src/db/repositories/sealed-form-values.ts',
      'src/db/repositories/staff-mfa.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...dbInternals, cryptoOutsideMapping, adapterOutsideRegistry, anthropicSdk],
      }],
    },
  },
  // No dbInternals: these are the files that legitimately import the generated client and the connection.
  {
    files: ['src/db/restricted/**/*.ts', 'src/db/prisma.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [cryptoOutsideMapping, adapterOutsideRegistry, anthropicSdk],
      }],
    },
  },
  {
    files: ['src/app/**/*.ts', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          { group: ['@/db', '@/db/*'], message: appMessage },
          { regex: '^\\.\\.(/\\.\\.)*/db(/|$)', message: appMessage },
          adapterOutsideRegistry,
          anthropicSdk,
        ],
      }],
    },
  },
  // Dev-only pages are never built in production (ADR-011), so one may drive a mock adapter's dev
  // control directly (ADR-TBD-C). This restates the src/app/** patterns minus
  // adapterOutsideRegistry, because a later block replaces the rule's options (ADR-022).
  {
    files: ['src/app/dev/**/*.dev.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          prismaOutsideDb,
          cryptoOutsideMapping,
          { group: ['@/db', '@/db/*'], message: appMessage },
          { regex: '^\\.\\.(/\\.\\.)*/db(/|$)', message: appMessage },
          anthropicSdk,
        ],
      }],
    },
  },
  // Last, so it replaces every block above for these files (ADR-022: a later matching config
  // replaces the rule's options). It restates the two patterns it keeps; omitting them would
  // silently disable both here.
  {
    files: ['src/integrations/registry.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [prismaOutsideDb, cryptoOutsideMapping, anthropicSdk] }],
    },
  },
  // The one file that calls a model: the blocks above minus anthropicSdk (ADR-022).
  {
    files: ['src/integrations/adapters/judge/claude.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [prismaOutsideDb, cryptoOutsideMapping, adapterOutsideRegistry],
      }],
    },
  },
]);

export default eslintConfig;
