# Architecture

One Next.js app. A pure rules core, a thin service layer, and every external system behind a port.

## Layers

```
src/app/            React Server/Client Components, routes, Server Actions   → may import server, domain, ui
src/server/         use cases: orchestration, transactions, authz, audit     → may import domain, db, integrations
src/domain/         pure business rules. No I/O, no Prisma, no Next, no fetch → imports nothing but domain + zod
src/db/             Prisma client, repositories, encryption, restricted-store accessors
src/integrations/   ports (interfaces) + adapters (real/mock) + job queue
src/ui/             design-system primitives, no domain knowledge
src/lib/            genuinely generic helpers (formatting, ids). No domain knowledge.
```

**The import rule, in one line:** an arrow may only point downward in that list.
`domain` is the bottom and imports nothing else in `src/`. A lint rule enforces this.

`src/integrations/queue/` and the stateful mock adapters are the only parts of `integrations` that
persist state (ADR-042). The AlayaCare export adapter also persists files under `STORAGE_ROOT`
(`_alayacare-export/`, ADR-154), beside the queue and the stateful mocks. They reach Postgres through `src/db/repositories/*` (the queue via
`jobs.ts`) and never through Prisma directly.

Why: the requirements engine, identity matching, and clearance evaluation are the product.
Keeping them pure makes them testable without a database and reusable from any entry point.

## Directory map

```
src/
  instrumentation.ts             Node-runtime boot hook: assertEveryPortResolves() (ADR-063)
  app/
    _components/                 app-level client components that know the domain (<Sensitive>)
    (caregiver)/                 phone-first flow, caregiver session only
      intake/[step]/
      documents/
      status/
    (staff)/                     coordinator / supervisor / admin, staff session only
      pipeline/
      caregivers/[id]/
      queue/                     exception queue
      clearance/[id]/
      admin/                     requirement templates, AlayaCare mapping, users
    r/<kind>/[token]/            public tokenised pages (invite, email, staff-invite, reference) — no session
    api/
      webhooks/[provider]/       e-sign + background-check callbacks
  domain/                        pure rules. zod and date-fns only — never Prisma, Next, React
    requirements/                template layering, instance materialisation, clearance eval
    identity/                    cross-document identity matching rules
    documents/                   document-set selection, evidence typing
    pipeline/                    stage state machine + transition table
    sync/                        AlayaCare mapping schema and field projection (ADR-075/076)
    validation/                  shared zod primitives (SSN, phone, DOB, address, ABA)
    audit/                       audit vocabulary and input schema
    auth/                        UserRole union, data classes, the role ceiling, Principal
    masking/                     sensitive-field vocabulary, masks, reveal input schema
  server/
    caregivers/  intake/  review/  clearance/  sync/  auth/  audit/  dev/  jobs/
  db/
    prisma.ts                    the shared client; CorePrismaClient omits the restricted models
    crypto.ts                    field encryption — reachable only from db/mapping/
    audit.ts                     runInAuditedTransaction, writeAuditEntry, the AuditedTx brand
    maintenance.ts               dev database reset and row counts
    factories.ts                 seed factories — type-only imports, so tsx can load it
    mapping/                     date-only, address, sealed selects, tenancy keys
    generated/                   prisma-client output, committed
    restricted/                  the only door to the medical and eeoc schemas
    repositories/
      sensitive-field.ts         the one read-path decrypt, audited in the transaction that reads it
  integrations/
    ports/       one .ts per port, interfaces + zod result types
    adapters/    <port>/<vendor>.ts and <port>/mock.ts
    queue/       job queue with retries + sync log
  ui/
  lib/
prisma/
  schema.prisma  migrations/  seed.ts
docs/
scripts/
  worker.ts   the job worker process (ADR-089)
```

## Data flow: the one path that matters

```
Offer accepted
  → server/intake.invite        email via messaging port, creates Caregiver + Invite
  → app/(caregiver)/intake      form engine reads the resolved requirement set
  → server/forms.generate       document-set engine → pdf-lib fill → e-sign port
  → app/(caregiver)/documents   upload → extraction port → domain/identity match → judge port
  → server/review.decide        auto-accept iff extraction + match + judge all pass
      ↳ else → exception queue (staff)
  → app/(staff)/caregivers/[id] every requirement instance + status, supervisor signs off
  → queue: sync.alayacare       mapped write, idempotent, logged
  → Active
```

## Requirements engine is the spine

Everything downstream reads from one structure: a **requirement instance** — a row linking
a caregiver, a requirement template, its evidence, a status, and an expiry date.

- Intake asks only for fields that some active requirement needs.
- The document-set engine emits only documents some active requirement needs.
- Clearance is `every blocking instance is satisfied`.
- The AlayaCare sync writes credentials derived from satisfied instances.

Build the requirements engine before anything that consumes it. The DAG enforces this.

## State, not inference

Pipeline stage is an explicit column driven by a state machine in `domain/pipeline`, not
derived at read time. The coordinator dashboard needs "days in stage", which requires
recorded transitions. Every transition writes a `PipelineEvent`.
