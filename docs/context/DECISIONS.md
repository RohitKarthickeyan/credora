# Decision log

Append-only. Newest last. One entry per decision that a future agent would otherwise
re-litigate. Keep each to the four headings — if it needs more, it is two decisions.

Format:

```
## ADR-00n — <title>   (date, task)
**Decision.** one or two sentences.
**Because.** the forcing constraint.
**Rejected.** what else was on the table and why not.
**Consequence.** what this now obliges us to do.
```

---

## ADR-001 — Mock adapters behind real port interfaces  (2026-09-22, setup)

**Decision.** Every external system sits behind a port interface with a deterministic mock
adapter. No real vendor credentials exist in this build; no code path requires one.

**Because.** We have no credentials for AlayaCare, DocuSign, an OCR vendor, the background
check vendor, or an SMS provider, and the PRD's own open questions say access to several is
unconfirmed. Waiting on access would stop the build; coding directly against a vendor SDK
would have to be undone when access arrives.

**Rejected.** Stubbing the integration layer as unimplemented — that removes the PRD's core
promise (AlayaCare sync) and leaves the hardest design work undone. Also rejected: skipping
the port layer and calling vendors directly, which makes WellSky/AxisCare a rewrite rather
than a connector, contradicting the architecture section of the PRD.

**Consequence.** Mocks must be genuinely adversarial, not happy-path — the AlayaCare mock
serves conflicts, rate limits, and missing ids on purpose (`INTEGRATIONS.md`). Swapping in a
real vendor is a new file in `adapters/<port>/` plus an env var.

---

## ADR-002 — Postgres in Docker with Prisma multiSchema  (2026-09-22, setup)

**Decision.** Postgres 16 via docker-compose, Prisma with `multiSchema` and three schemas:
`core`, `medical`, `eeoc`.

**Because.** The PRD requires medical and EEOC data to live in separate restricted stores. A
schema boundary makes an accidental `include:` into the personnel file impossible rather than
merely discouraged, and Postgres is what the PRD names.

**Rejected.** SQLite — no schema separation, and migrations would need rewriting later.
Separate databases — correct in production, but the operational cost is not worth it before
there is a production.

**Consequence.** Docker Desktop must be running for migrations and local dev. Restricted
models may only be imported from `src/db/restricted/`, enforced by lint.

---

## ADR-003 — One LLM call in the entire product  (2026-09-22, setup)

**Decision.** The only runtime LLM use is the home-care record validity judge. Everything
else — identity matching, extraction, requirement resolution, form filling, clearance, field
mapping — is deterministic. The register is `docs/context/AGENTIC-TASKS.md`; adding to it
requires a new ADR.

**Because.** The PRD describes one genuinely discretionary judgement ("is this from a
legitimate issuer") and a great many rules. Rules must be auditable and explainable to a
state surveyor; an LLM in the identity-matching path would be neither. Determinism also makes
the whole pipeline testable.

**Rejected.** An agentic document-review loop. This is one bounded classification against a
fixed schema — a single Messages API call is the right size. The Claude Agent SDK earns its
place only if the judge later needs to *fetch* evidence (e.g. query a state registry), which
would be a tool-use loop and a new ADR.

**Consequence.** The judge port ships a deterministic mock that CI and local dev run against,
so the test suite never depends on a model. The real adapter is written only against the
`claude-api` skill's current model ids, never from memory.

---

## ADR-004 — Cache Components stays off  (2026-09-22, setup)

**Decision.** Do not enable `cacheComponents` in `next.config.ts`. Keep Next 16's default
request-time model.

**Because.** Every page in this product is authenticated and agency-scoped; there is nothing
worth prerendering. `"use cache"` cannot read `cookies()` or `headers()`, which is exactly
what every query here needs, and enabling it removes the `dynamic`/`revalidate` route exports.

**Rejected.** Turning it on for the marketing surface — there is no marketing surface in V1.

**Consequence.** Mutations invalidate with `revalidatePath`. If caching is ever wanted, it
needs a new ADR, not a config flag flipped in passing.

---

## ADR-005 — One storage port owns every byte  (2026-09-22, T-017)

**Decision.** A `storage` port with a local-disk adapter, created in phase 1, owns the key
convention `<agencyId>/<caregiverId>/<kind>/<ulid>.<ext>`. Camera uploads, generated PDFs,
signed PDFs, documents streamed to AlayaCare, and audited deletion all address bytes by that
key. Nothing else constructs a path.

**Because.** The DAG review found five tasks across five waves that write or read binaries
with no shared contract, and the reconciliation would have landed in `T-115` — deep in the
serial tail, immediately upstream of the end-to-end test. The extraction mock had already
assumed a "fixture by filename" scheme three waves before upload existed.

**Rejected.** Letting `T-070` own storage as a side effect of the upload UI, which is how
revision 1 had it. A foundation concern buried in a wave-7 UI task is a foundation concern
four other tasks will each re-invent.

**Consequence.** `T-017` blocks `T-050`, `T-053`, `T-061`, `T-062`, `T-064`, `T-070`, `T-115`,
`T-130` and `T-132`. Moving to S3 later is one adapter file.

---

## ADR-006 — MFA is built, SSO is deferred  (2026-09-22, T-023)

**Decision.** Implement TOTP enrolment, verification at login, recovery codes, and per-agency
enforcement (`T-023`). Do not implement SSO in V1.

**Because.** The PRD requires "single sign-on **or** enforced multi-factor authentication for
agency users". Revision 1 shipped an `mfaEnforced` boolean that enforced nothing, which
satisfies neither limb. One of the two has to be real, and TOTP is far cheaper than a SAML or
OIDC integration per agency.

**Rejected.** Descoping the bullet. It is a stated security requirement for a system holding
SSNs and bank accounts, and "we have a flag for it" is the kind of gap a SOC 2 reviewer finds.

**Consequence.** `T-020` ships sessions and password auth only; `T-023` follows immediately.
SSO becomes an auth adapter post-V1, not a rewrite.

---

## ADR-007 — The exception queue can act, not just display  (2026-09-22, T-123)

**Decision.** Split exception *resolution* (`T-123`) from exception *display* (`T-121`).
Coordinators can accept over the judge, reject, waive, or request a re-upload with a
notification to the caregiver.

**Because.** The PRD's workflow diagram has an arrow from the staff queue back into review,
and 30% of uploads are expected to land there by the success metrics. Revision 1 had a
read-only queue, which left that arrow unimplemented, made the `WAIVED` status unreachable,
and left every non-auto-accepted item with no path to `SATISFIED` — which clearance depends
on.

**Rejected.** Folding resolution into `T-121`. The dependency sets differ (resolution needs
the messaging port and the upload flow), and the review's point stands: an implicit
requirement is one that gets skipped.

**Consequence.** Every accept-over-the-judge is audited with the actor and a reason, which is
also what makes the weekly sampling in `T-075` meaningful.

---

## ADR-008 — Minimum caregiver age is a product default, not a researched statute  (2026-09-22, T-004)

**Decision.** `MINIMUM_AGE_YEARS = 18`, exported as a named constant from
`src/domain/validation/date-of-birth.ts` and read by the schema, not inlined. It is marked
unconfirmed in the code. Changing it is a one-line change.

**Because.** The PRD specifies a "DOB range" and nothing more; `DOMAIN.md`, `DATA-MODEL.md`
and `SECURITY.md` are silent on age, and no NY statutory minimum for a PCA or HHA could be
established from the in-scope material. The defensible basis is contractual rather than
regulatory: intake terminates in an e-signed W-4, I-9 §1, a direct-deposit authorisation and
FCRA consent, and a minor's signature on those is at best voidable.

**Rejected.** Inventing a regulatory citation, which would read as researched fact in a
compliance product and be believed. Also rejected: leaving the bound out entirely, which
would let a DOB typo through to a federal form.

**Consequence.** This needs a product-owner answer before real caregiver data is accepted.
Until then the constant is the single place to change and `date-of-birth.test.ts` asserts the
boundary against the constant rather than against a literal, so a new value does not
invalidate the tests.

---

## ADR-009 — Pin Prisma to 7.10.0; the installed 8.0.0-rc cannot express ADR-002  (2026-09-23, T-002)

**Decision.** Pin `prisma` to `7.10.0` to match the already-installed `@prisma/client@7.10.0`,
and add `@prisma/adapter-pg@7.10.0`. Prisma 8 is not adopted in this build.

**Because.** The scaffold installed `prisma@^8.0.0-rc.15` — npm's `latest` tag is a release
candidate — against a 7.10.0 client. They are different products, and the mismatch is fatal
rather than cosmetic:

- `npx prisma generate` returns `CLI.UNKNOWN_COMMAND`. Prisma 8 has no `generate` and no
  `migrate`; its command set is contract/Composer based.
- `@@schema` and `previewFeatures` appear nowhere in `@prisma/orm-framework`, so **Prisma 8 RC
  cannot express multiSchema at all** — and multiSchema is the entire mechanism by which
  ADR-002 makes an accidental join into the medical or EEOC store impossible rather than merely
  discouraged. Without it, ADR-002 degrades to a naming convention.

Verified directly, not recalled: the failing `generate` invocation, the absence of `@@schema`
in the 8.x framework dist, `npm view prisma dist-tags` showing `prev: 7.10.0`, and
`prisma@7.10.0 --help` listing both `generate` and `migrate`.

**Rejected.** Waiting for Prisma 8 stable — it blocks T-010 and therefore most of the graph.
Rewriting ADR-002 around `@@map`-prefixed tables in one schema — that is the "merely
discouraged" boundary ADR-002 exists to avoid. Upgrading the client to 8.x — the runtime
`@prisma/orm-postgres` is published only as `8.0.0-rc.9-dev.13`.

**Consequence.** Three 7.10.0-specific facts now bind every later data task, each verified
against the installed package: `previewFeatures = ["multiSchema"]` must be **removed** (it is
GA and now warns as deprecated); `datasource.url` in the schema file is a **hard error** —
connection URLs move to `prisma.config.ts`; and a **driver adapter is mandatory**, which is why
`@prisma/adapter-pg` is added. Prisma 7 also no longer loads `.env`, so `prisma/database-url.ts`
uses Node's built-in `process.loadEnvFile`. Revisit when Prisma 8 ships stable with multiSchema.

---

## ADR-010 — Database tests are a third vitest project, isolated by truncation  (2026-09-23, T-005)

**Decision.** Tests that need Postgres are `*.db.test.ts` in a third vitest project, `db`,
pointed at a separate `credora_test` database. They skip when Postgres is unreachable and
fail hard when it is reachable but unmigrated. Isolation between them is `TRUNCATE` of every
table in `core`, `medical` and `eeoc` before each test, not transaction rollback.

**Because.** `npm run test` passed with the container stopped before this task and that is
worth keeping: a pure domain rule should be reviewable without Docker Desktop. Rollback
isolation is unavailable at any price here — nothing injects a client (`CONVENTIONS.md`
§ Database has repositories import `prisma` directly), and `$transaction` has no nested
interactive form, so every use case that opens its own transaction inside a test's outer one
would fail. The truncation statement is built from `information_schema` rather than from a
list of delegates, so T-010's models require no change to it.

**Rejected.** Putting database tests in the `unit` project — that makes the default run
require Docker. A skip-if-no-database guard inside `unit` — a database probe in front of 112
pure tests, and one project with two meanings. `@testcontainers/postgresql` or a per-worker
database — real isolation, no install cost worth paying while one serialised database works.
Skipping on an unmigrated database — that reports green on a misconfiguration.

**Consequence.** `npm run test` can be green with the database tests silently skipped, so
whichever task adds CI must run `npm run db:up` and then `npm run test:db` as its own step,
not rely on `npm run test`. `truncateAllTables` in `src/db/maintenance.ts` is the only place
that truncates, and it refuses when `NODE_ENV` is `production`. Its raw SQL reaches into
`medical` and `eeoc`, which is not an ADR-002 violation: it names no model and reads no value.

---

## ADR-011 — The dev tools route is excluded from the production build  (2026-09-23, T-005)

**Decision.** `src/app/dev/page.dev.tsx` is routed only by a `pageExtensions` entry that
`next.config.ts` drops when `NODE_ENV` is `production`. There is no runtime guard.

**Because.** The page carries an inline Server Action that truncates the database. A
`NODE_ENV !== 'production'` check returning `notFound()` stops the page *render* only: the
module is still compiled, so the action is still registered and still reachable by POST to
`/dev` with its action id. Build-time exclusion is the only mechanism of the three considered
that removes the POST surface, because the file is never an entrypoint and no action id
exists. A `proxy.ts` matcher has the same hole and, per `NEXTJS-16.md` § 3, is not an
authorization boundary. Verified against a production server: `GET` and `POST /dev` both 404
while `/` serves, a row inserted beforehand survives the POST, the route table lists only `/`
and `/_not-found`, and `truncateAllTables` appears nowhere under `.next/`.

**Rejected.** A `NODE_ENV` runtime guard and a proxy matcher, for the reason above. A password
or `DEV_TOOLS_TOKEN` on the page — a secret guarding a page that is not built is theatre.

**Consequence.** `pageExtensions` is additive: dropping `'tsx'` or `'ts'` from the array
breaks every route at once, so the build's route table is the check. The excluded file is
still typechecked, because `tsconfig.json` includes `**/*.tsx` independently of routing, so it
cannot silently rot. Because the action has no production endpoint, it is exempt from
`CONVENTIONS.md` § Server / client boundary's authenticate → authorize → validate → use case
sequence — the only such exemption in `src/app/`, and it is bought by this mechanism alone.

---

## ADR-012 — The status→presentation binding moves to `src/app/_lib/`  (2026-09-23, T-032)

**Decision.** `src/ui/status.ts` moves to `src/app/_lib/status.ts` and keys its maps off the
domain unions (`PIPELINE_STAGES` from `src/domain/pipeline/stage.ts`, and T-032's instance
status union) via `Record<PipelineStage, StatusPresentation>`. `StatusBadge` stays in `src/ui`
and stays generic — it takes `{ tone, label, glyph }` and never sees a status name. T-032
performs the move.

**Because.** T-010's review found the compile-safety story in its own § Design 5 does not work:
`eslint.config.mjs` forbids `src/ui/**` from importing `@/domain` *and* `@/db`, so a UI file can
reach neither source of truth. The nine pipeline-stage names are currently written out three
times — the Prisma enum, `src/domain/pipeline/stage.ts`, and `src/ui/status.ts`, plus a fourth
hand-written copy in `src/ui/status.test.ts`. They agree today and **nothing fails if one
drifts**. T-010's mirror test guards only the first two.

`src/app` may import `src/domain` (it is the composition layer), so moving the binding one
directory outward is what makes a rename a compile error instead of a silent inconsistency.

**Rejected.** Relaxing the lint rule to let `src/ui` import `@/domain` — `CONVENTIONS.md` § UI
says "Primitives in `src/ui/` know nothing about caregivers", and a type-only exemption is not
enforceable by a rule that matches specifiers. Also rejected: leaving the copies and adding an
equality test, which is what the duplication already has and which fails to stop the drift it
detects.

**Consequence.** T-032 moves the file, deletes the hand-written copy in the test, and keys both
status maps off the domain unions. Any later task adding a pipeline stage or an instance status
then gets a compile error listing every presentation it has not yet defined, which is the
desired failure. This supersedes the interim orchestrator ruling recorded in
`docs/tasks/T-003-ui-primitives/PLAN.md` § Risks 1, which kept the file in `src/ui` only until
the domain union existed.

---

## ADR-013 — One field-encryption key, self-describing envelope, no rotation in V1  (2026-09-23, T-012)

**Decision.** Encrypted fields are AES-256-GCM in a 33-byte self-describing envelope —
`version(1) ‖ keyId(4) ‖ nonce(12) ‖ authTag(16) ‖ ciphertext`, with `version ‖ keyId` as the
GCM additional authenticated data. The key id is derived (`sha256(key)[0..4]`), never
configured. One key, from `FIELD_ENCRYPTION_KEY`. The format supports rotation; V1's
configuration does not, so V1 cannot rotate.

**Because.** The key id must not be able to desynchronise from the ciphertext it describes, and
a value that carries its own format and key id can be migrated row by row instead of by a
flag-day rewrite. Building a rotation pipeline before there is production data is speculation.

**Rejected.** A sibling `<field>KeyId` column — four more columns and two rows that can
disagree. A KMS — there is no cloud account yet and the BAA-signing provider is undecided
(`PRD.md`). Shipping `FIELD_ENCRYPTION_KEY_RETIRED` now — there is no key to retire.

**Consequence.** Changing `FIELD_ENCRYPTION_KEY` makes every stored ciphertext permanently
unreadable until a retired-key entry and a re-encryption pass exist; it fails loudly, with
`No key is configured for encrypted-field key id <hex>`, rather than returning wrong plaintext.
Closing the gap is one optional env var, one extra keyring entry and a re-encryption pass over
four columns — no schema change and no migration, because the key id is already in every
envelope. This is a known gap, not an oversight.

---

## ADR-015 — The audit trail is a compiler rule, a database rule, and an async-local
actor  (2026-09-23, T-013)

**Decision.** Three things, one mechanism.

1. The actor lives in an `AsyncLocalStorage` in `src/db/audit.ts`, established once at a
   boundary by `runWithAuditContext` and read by `writeAuditEntry` through
   `requireAuditContext`, which throws when none is set. No caller passes an actor.
2. `AuditEntry` declares no foreign key in any direction and has no `caregiverId`. Its subject
   is the polymorphic `entityType` + `entityId` pair. It also has no `updatedAt` and no column
   able to hold a value.
3. `writeAuditEntry` accepts only `AuditedTx`, a branded type that only
   `runInAuditedTransaction` can produce, and that type **omits** `medicalFile` and
   `eeocRecord`. `runInAuditedTransaction` joins an already-open transaction rather than
   nesting. Append-only is enforced by a `BEFORE UPDATE OR DELETE … FOR EACH ROW` trigger,
   `core.audit_entry_append_only`, plus a CHECK constraint tying `actorRole = 'SYSTEM'` to a
   null `actorId`.

**Because.** `CONVENTIONS.md` already said "the audit entry is written in the same transaction
as the thing it audits", and a sentence in a document is not a mechanism: an entry that
outlives a rolled-back mutation is a false claim that something happened, and a mutation with
no entry is exactly what `SECURITY.md § Audit log` forbids. Making the transaction the only key
to the writer turns both into compile errors. Taking the actor from the ambient context rather
than a parameter means no caller can attribute an action to someone else, and a boundary that
forgets to establish it gets an exception rather than an anonymous row — fail-closed. Joining
rather than nesting is forced by ADR-010's finding that Prisma has no nested interactive
transaction: nesting would silently give two transactions on two connections and lose the
rollback guarantee outright. The foreign-key-free row is what lets the log outlive what it
describes — a `Cascade` would delete the audit trail along with the record whose deletion most
needs auditing, and a `Restrict` would make that record undeletable and break
`SECURITY.md § Retention`. And narrowing `AuditedTx` closes the hole that ADR-002's
import-based lint never reached: a `tx` handed to a callback exposed every restricted delegate,
so `runInAuditedTransaction(tx => tx.medicalFile.findFirst(…))` would have compiled and
bypassed both the accessors and this log. ADR-002's boundary now holds for the transaction
callback exactly as it holds for the client.

**Rejected.** *Passing the actor into every repository function* — the same fact threaded
through every signature in the project, and every one of them a place to pass the wrong actor.
*A `DO INSTEAD NOTHING` rule instead of the trigger* — a tamper attempt that appears to succeed
is worse than one that fails loudly. *`REVOKE UPDATE, DELETE`* — the application connects as
the table's owner, and an owner is not bound by grants it can re-grant; making it real needs a
second, non-owning role, which is a deployment change. *A statement trigger covering `TRUNCATE`*
— it would break `truncateAllTables` and therefore every `*.db.test.ts` (ADR-010). *A
`previousValue` column so the log can answer "what did it become"* — `SECURITY.md` forbids
values in the log, and `ARCHITECTURE.md § State, not inference` already answers that question
with domain rows. *Reusing `UserRole` with a nullable `actorRole` for the system actor* — a null
role in an audit log reads as *unknown*, the one thing the row may not be. *Leaving the
transaction-client hole open as a follow-up* — a boundary that holds for the client and
silently does not hold for a transaction callback is a distinction no later implementor will
remember. *Widening `AuditedTx` so the restricted accessors can use it* — the accessors get a
second, unexported branded type inside their own directory instead.

**Consequence.** Every use case from here on opens `runInAuditedTransaction` from `@/db/audit`,
not `prisma.$transaction`; `CONVENTIONS.md § Database` now says so. **T-014 and T-024 must wrap
every Server Action, route handler and queue job in `runWithAuditContext`** — until they do,
the four restricted accessors throw for every caller. `tx.medicalFile` is a compile error
outside `src/db/restricted/`, and a task that needs medical or EEOC data calls an accessor.
T-130 inherits three facts: deleting a caregiver deletes no audit rows, the deletion itself must
be audited by its own use case, and deleting audit rows requires
`ALTER TABLE core."AuditEntry" DISABLE TRIGGER audit_entry_append_only` inside the sweep's
transaction — the trigger name is part of this task's contract. The trigger guards against
application bugs and casual tampering, **not** against a compromised database credential; real
tamper-evidence (a second role, off-box log shipping, hash chaining) is a later ADR. Prisma does
not introspect triggers, so no generated migration will restore it if it is dropped by hand;
`src/db/audit.db.test.ts` is what notices.

**Limit.** The `AuditedTx` narrowing is a *compile-time* boundary, exactly as strong as
ADR-002's `CorePrismaClient` and no stronger: at runtime the callback object still carries both
delegates, and a deliberate cast defeats it. It stops the accident, not the intent.

---

## ADR-016 — The storage port ships without a registry and without a mock adapter  (2026-09-23, T-017)

**Decision.** T-017 creates `src/integrations/ports/storage.ts` and
`src/integrations/adapters/storage/local.ts` standalone: no `src/integrations/registry.ts`, no
registry slot, no placeholder for any other port, and no exported singleton. `local.ts` is this
port's dev and test adapter, so there is no `mock.ts` and no `fixtures/` directory.
`STORAGE_ROOT` ships now, in `src/lib/env.ts` and `.env.example`, because the adapter itself
reads it as the default value of `createLocalDiskStorage`'s parameter. `STORAGE_ADAPTER` ships
with T-050's `registry.ts`, because only the registry may read it.

**Because.** `INTEGRATIONS.md` Rule 3 puts adapter selection in a file T-050 owns and says
nothing else chooses an adapter. The same document's § Ports row for `storage` gives the vendor
column as "S3 / GCS" and the mock-behaviour column as "Local disk under `storage/`" — local disk
*is* the mock here, which its env default confirms: every other port defaults to `=mock` and
`STORAGE_ADAPTER=local` is the single exception. Every one of ADR-005's nine downstream
consumers is at or after T-050, so nothing in the graph needs a storage instance before the
registry exists.

**Rejected.** A second, in-memory adapter with no caller, written only to satisfy Rule 2's
"every port has `mock.ts`" literally. A `STORAGE_ADAPTER` variable added to the boot schema now
as `z.literal('local').default('local')` — a variable no code reads is the speculative
configurability `CONVENTIONS.md` forbids, and it would put a selection decision outside the one
file that owns selection.

**Consequence.** `INTEGRATIONS.md § Env vars` and `.env.example` disagree about
`STORAGE_ADAPTER` until T-050 lands; that is the correct intermediate state, not drift. T-050
finds the port already written, registers it rather than designing it, writes
`storage: createLocalDiskStorage()`, and adds `STORAGE_ADAPTER=local` to both env files in the
same change. T-050 is also the right place to add the eslint `src/integrations/**` override that
stops a later task importing `adapters/storage/local.ts` directly — a rule guarding a registry
that does not exist yet cannot be written correctly.

## ADR-017 — The object-name ULID is written here, not installed  (2026-09-23, T-017)

**Decision.** `src/lib/ulid.ts` — one exported function and one exported pattern, about forty
lines, importing nothing. No dependency is added to the project.

**Because.** Node 24 has neither a UUIDv7 nor a ULID generator: `node:crypto` on the installed
v24.14.1 exposes `randomUUID` (v4) and no `randomUUIDv7`, and Prisma's `uuid(7)` is generated
*inside the database*, so there is nothing in application code to reuse. Both `INTEGRATIONS.md
§ Storage keys` and ADR-005 fix `<ulid>` in the key, and the only feature the npm `ulid` package
adds over forty lines of Crockford base32 is a monotonic factory we do not need — a collision
would require two objects for the same caregiver and kind in the same millisecond *and* an
80-bit clash. `ARCHITECTURE.md § Layers` names `src/lib/` as the home of generic id helpers.

**Rejected.** `npm i ulid` — a production dependency, in a product whose PRD names SOC 2
readiness, bought for one base32 encoding. UUIDv4 from `crypto.randomUUID` — not time-ordered,
and it would contradict two governing documents. Reusing `uuid(7)` — it does not exist outside
the database.

**Consequence.** Entity ids stay `uuid(7)` per T-010 § Design 1 and object names are ULIDs. The
two are the same design — 48 bits of Unix milliseconds then randomness, lexically sortable in
creation order — differing only in alphabet, and neither converts to the other. The encoding is
pinned by an all-zero golden vector and by the ULID specification's own published example
(`1469918176385` → `01ARYZ6S41…`), so it cannot drift. At this project's ES2017 target the
implementation must use `BigInt(…)` calls rather than BigInt literals; only `npm run build`
catches a regression there, because vitest's transform accepts the literal.

---

## ADR-018 — `src/db/factories.ts` may import types only  (2026-09-23, T-005b)

**Decision.** `src/db/factories.ts` contains no runtime import of any kind. Every import is an
`import type`, and the Prisma client is the first parameter of every factory rather than a
module-level import. Anything under `src/db/` that must be callable by the seeder follows the
same rule.

**Because.** `npm run db:seed` is `tsx prisma/seed.ts`. `server-only` is not an installed
package — it resolves under vitest only through the alias in `vitest.config.mts`, which `tsx`
does not have. `src/db/prisma.ts` → `src/db/restricted/connection.ts` → `@/lib/env` is a
runtime chain ending at `import 'server-only'`, so any module importing the client as a value
is unloadable by the seeder's runner. Verified, not assumed: under `npx tsx`,
`import('@/db/factories')` yields all five exports while `import('./src/db/prisma.ts')` fails
with `MODULE_NOT_FOUND: Cannot find module 'server-only'`. Under `verbatimModuleSyntax` a type
import is fully erased, so the compiled module has no `require` at all.

**Rejected.** A `tsx --import` shim or a tsconfig `paths` entry mapping `server-only` to a
no-op — each adds machinery to make a bad import legal where one parameter makes the import
unnecessary, and the `paths` entry would additionally neuter the real `server-only` guard in
the Next build, which is a security boundary rather than a nuisance. Installing the real
`server-only` package is worse: its non-`react-server` export throws by design, turning a
resolution error into a runtime throw. Also rejected: factories for tests only, with T-132
hand-writing its own inserts — that recreates the duplicated-canonical-record problem
`DATA-MODEL.md` invariant 1 exists to prevent.

**Consequence.** Factories never encrypt: `src/db/crypto.ts` is itself `server-only`, so a
caller that needs a sealed value calls `encryptFieldWithLast4` at its own call site and passes
the `{ enc, last4 }` pair through the relevant override.
**Enforced by** `src/db/factories.test.ts` → "every import is an import type", which reads the
source and fails on any line not beginning `import type `. Added by the orchestrator after
T-005b's checker observed that the invariant was otherwise guarded only by a comment: a value
import would break `npm run db:seed` while build, lint and every other test stayed green.
Mutation-tested — injecting `import { randomUUID } from 'node:crypto'` fails the assertion.

---

## ADR-021 — Pipeline transitions are a pure table with a Result-shaped refusal; `PipelineEvent` and `AuditEntry` both exist  (2026-09-23, T-015)

**Decision.** The legal moves are a fourteen-row table in `src/domain/pipeline/transitions.ts`,
keyed by `(from, event)` over eight past-tense event names. `transition()` returns a Result —
`{ ok: true, to }` or one of `ALREADY_APPLIED` / `TERMINAL_STAGE` / `ILLEGAL_TRANSITION` —
classified in the order *already-applied → legal → terminal → illegal*. Every `ok: true` writes
exactly one `PipelineEvent` in the same `runInAuditedTransaction` as the fact that caused it and
as the audit entry; `ALREADY_APPLIED` writes none. `PipelineEvent` and `AuditEntry` remain
separate models, neither derived from the other.

**Because.** Two triggers — the e-sign webhook and the AlayaCare sync worker — are at-least-once
by construction, so a redelivery must be an ordinary outcome, not an error: testing
already-applied before terminality is what stops `transition('ACTIVE','SYNC_COMPLETED')`
surfacing a staff-facing error, and writing no row on a retry is what keeps a zero-length stage
occupancy out of every duration report. The two models exist because their lifetimes differ:
`PipelineEvent` is caregiver history and cascades with the caregiver; an audit entry must
outlive the record it describes. Merging them loses one property or the other — the audit log
stores no values, so "days in stage" would have nothing to read, and folding the audit trail
into a cascading child makes it deletable by the person it incriminates.

**Rejected.** Throwing on an illegal move (forces `try/catch` at all eight call sites, which
`CONVENTIONS.md § Error handling` forbids). Backward edges for rework (a rejected document is a
requirement instance in `EXCEPTION`, per the PRD's dashed exception loop; a regression would let
a caregiver occupy `DOCUMENT_REVIEW` twice and corrupt every duration metric). Skip edges when an
agency has no background-check vendor (the use case fires `VERIFICATION_COMPLETED` immediately —
one extra row beats doubling the table). A `nextStage()` helper (a caller that discards the
reason writes the column anyway). A genesis event for `INVITED` (`Caregiver.createdAt` already
carries that instant, and it would force `fromStage` nullable for one case).

**Consequence.** `Caregiver.stage` may only be written from an `ok: true` result. `ACTIVE` and
`WITHDRAWN` are both sinks refusing with `TERMINAL_STAGE`, so V1 cannot offboard an active
caregiver and a withdrawn one cannot re-enter — a re-hire is a new `Caregiver` row with no link
to the first (open questions 8 and 9). `isTerminal` is "no outbound edge in the table", so
adding an edge out of `ACTIVE` later needs no second edit. `PipelineEvent.reason` is uncontrolled
free text in a `core` column, so a coordinator can type a medical reason into it (question 10);
a coded withdrawal-reason list would fix that and the drop-off metric's inability to separate a
ghosting applicant from a rescinded offer (question 12).

---

## ADR-023 — A Postgres job queue with `SKIP LOCKED`, not Redis

**Decision.** The job queue is two tables in `core` (`Job`, `JobAttempt`) plus one claim
statement — `WITH eligible AS (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) UPDATE … RETURNING` —
run at the default `READ COMMITTED`. No new dependency and no new piece of infrastructure.
`nextAttemptAt` is the single eligibility clock and doubles as the lease expiry while a job is
`RUNNING`, so a worker that dies mid-job is recovered by the next claimer rather than by a
reaper process or a `stuck` state. Backoff is deterministic and jitter-free
(10s/20s/40s/80s/160s/320s/600s, capped, eight attempts ≈ 20 minutes), a handler may override
the delay with a clamped `retryAfterMs` so a vendor's `Retry-After` is obeyed, and idempotency
is enforced by `@@unique([agencyId, idempotencyKey])` rather than by a check-then-insert.
Time is injected as `type Clock = () => Date`; no statement the queue writes calls the database
clock. (The one database clock left is `nextAttemptAt`'s `@default(now())`, which applies only
to an enqueue that passes no `runAt` — nothing on the claim, retry or dead-letter path.)

**Because.** Postgres already provides everything this design needs — row-level locking with
`SKIP LOCKED`, durable rows that survive a restart, and, decisively, **enqueue inside the same
transaction as the business write that justifies it**. A Redis queue cannot do that last one,
which is precisely the bug class this queue exists to prevent: a credential accepted but never
synced, or synced twice. The volume is hundreds of jobs a day, not millions, so nothing here is
paying for throughput. Jitter and a database-supplied `now()` were both rejected for the same
reason: either would make the retry schedule probabilistic or untestable without sleeping, and
`INTEGRATIONS.md § Rules` bullet 4 makes determinism a stated value of this build.

**Rejected.** *Redis + BullMQ* — a second store to run, back up and reason about, and no
transactional enqueue. *pg-boss / Graphile Worker* — the right idea, but they own the schema,
the migration story and the polling loop, which is most of this task plus a dependency.
*`node-cron`* — solves scheduling, which is T-018's, not claiming, which is this task's. *A
plain `UPDATE … WHERE state = 'PENDING' LIMIT`* — Postgres row locks would still make it safe,
but concurrent claimers would block on each other instead of partitioning the batch, and would
deadlock in whatever order the planner happened to visit rows. *`REPEATABLE READ` or
`SERIALIZABLE` around the claim* — `SKIP LOCKED` under either produces serialization failures
instead of throughput, and the correctness argument needs nothing above `READ COMMITTED`. *A
reaper process or a fifth `STUCK` state* — a second source of truth for eligibility, when the
lease already is one. *Encrypting `payload`* — treating the symptom of putting values in it.

**Consequence.** Four things are now owed by other tasks.

1. **The claim query is the one deliberately unscoped write in the system**, against
   `DATA-MODEL.md` invariant 5. A claimer drains every tenant in one statement by design: an
   `agencyId`-leading index would make `Job_state_nextAttemptAt_idx` useless for it. It returns
   nothing to a user, and every other function still takes `agencyId` first (`listJobs`,
   `listJobAttempts`, `requeueJob`), with `enqueueJob`'s `agencyId` the first field of its
   input. Row-level security, if it ever lands, must exempt this statement.
2. **The lease can double-run a handler that outlives it** (5 minutes), but it can no longer let
   the loser's result win. *(Amended after review: as originally shipped, `finishAttempt` wrote
   unconditionally, so a stale worker could move an already-`SUCCEEDED` job back to `PENDING`
   and cause a third execution.)* `finishAttempt` now moves the job only under
   `state = 'RUNNING' AND claimedBy = <this worker>`, and returns `'lost-lease'` instead of
   writing when that does not hold. The attempt row is written either way, so a double-run
   leaves a visible second row at the same attempt number rather than no trace — which is also
   why `JobAttempt` carries an index rather than a unique key.

   **Both halves of the predicate are load-bearing.** `claimedBy` alone is only as strong as
   worker ids being distinct, which nothing enforces — `drainQueue` takes `workerId` from its
   caller and every hosting candidate in consequence 4 naturally passes a constant. `state`
   alone still permits the reverse ordering: the stale worker finishing *first* and rescheduling
   a job the live worker is mid-way through, producing the same third execution.

   Concurrent execution is still possible, so every handler must still be idempotent and the
   vendor-side idempotency key is still what makes a duplicate a no-op. What can no longer
   happen is a terminal job being resurrected, or `attempts` being advanced by a worker that has
   lost the row. `drainQueue` counts a lost race in none of `succeeded`/`retried`/`deadLettered`,
   so `claimed` exceeding their sum is the signal that a lease was overrun. `FinishAttemptInput`
   gains a required `workerId`, which must be the value passed to `claimJobs`.
3. **The payload carries identifiers, never values.** `payload` is plaintext `jsonb`, so a
   mapped SSN in there is an unencrypted SSN. No schema test can catch it — see § Follow-ups.
4. **Nothing runs `drainQueue` outside tests yet**, and that is a hosting decision (open
   question 18), not a gap to fill. All three candidates — a standalone worker process behind
   the `server-only` import, Next's `instrumentation.ts` `register()` hook, or a platform cron
   hitting a protected route — call the same `drainQueue` and change no line of this code,
   which is why the choice can wait. It cannot wait past T-111. Until a dead-letter screen
   exists (T-123), a `DEAD` job is visible only to someone running `listJobs`.

---

## ADR-022 — Field encryption is reachable only from `src/db/mapping/`

**Decision.** `@/db/crypto` may be imported only by `src/db/mapping/**` and by `crypto.ts`'s own
tests; every other file in `src/` fails `npm run lint` with a message naming the four column-group
functions to call instead. The rule is a `no-restricted-imports` **regex**, not a `group`, so it
catches the relative `./crypto` and `../crypto` forms as well as `@/db/crypto`, and it is repeated
in all six blocks that set `no-restricted-imports`, because a later matching ESLint config replaces
the rule's options rather than merging them.

**Because.** `DATA-MODEL.md § Field-level encryption` says "Exactly one module does this:
`src/db/crypto.ts`. Repositories call it; nothing else does", and until now nothing enforced it —
`T-012 § Risks 8` and T-012's review both record that a `src/server/` use case importing
`@/db/crypto` compiled and linted clean. T-002 and T-013 each showed that a compile-or-lint
boundary beats a documented one. `SECURITY.md § Field masking`'s "There is no other way to
decrypt" is a security claim, and a security claim enforced only by review is not enforced.

**Rejected.** (a) Leaving it to review — the status quo, and the thing T-012's review asked to
be fixed. (b) A `group` pattern — gitignore semantics would miss `./crypto`, the form a sibling
inside `src/db/` actually writes. (c) The compile-level equivalent: stop exporting `encryptField`
and have `crypto.ts` export only the four column-group functions, i.e. merge `sensitive.ts` into
`crypto.ts`. That is strictly stronger, but it rewrites T-012's shipped and reviewed module and
puts four column names into a deliberately field-generic file; it remains the alternative if a
reviewer prefers the stronger boundary, and it is T-012's file to change. (d) Allowing
`src/db/repositories/**` — that would let every future repository encrypt ad hoc, which is the
outcome the sentence forbids; `src/db/mapping/**` is a directory whose entire contents are
specified.

**Consequence.** T-019's `revealSensitiveField` must either put its `decryptField` call inside
`src/db/mapping/` or add its own directory to the `ignores` list in `eslint.config.mjs` — a
one-line, reviewable diff in a shared config file, which is the visibility a decrypt call site
deserves. Same for T-110's AlayaCare payroll sync. The rule is lint, not the compiler, so
`// eslint-disable-next-line` defeats it; that is accepted, because it converts an invisible
mistake into a deliberate, greppable one. Adding a fifth `*Enc` column means adding it to
`ENCRYPTED_COLUMNS`, after which `SealedSelect` makes the two select constants fail to compile
until the column is consciously handled.

*(Checker's amendment: the Decision paragraph as first written also allowed "one named legacy
exception", `src/db/factories.db.test.ts`. That exception has been removed and the test rewritten,
so the rule now has exactly two allowances. The rest of the ADR is unchanged and was verified
against the shipped config.)*

---

## ADR-020 — Authorization is a registry of actions under a role-matrix ceiling, and every use case is a `defineUseCase`

**Decision.** `SECURITY.md`'s role matrix is encoded once, in `src/domain/auth/role.ts`, as a
ceiling of `DataClass → UserRole[]`. `src/server/auth/policy.ts` registers each action against a
data class and a role list that must be a subset of that ceiling. Every use case is produced by
`defineUseCase(action, run)`, which reads the ambient principal, asserts the policy and only then
calls `run`. `policy.coverage.test.ts` fails if any exported function under `src/server/**` is not
such a use case, unless its module is in a written allowlist. `runAsPrincipal` establishes the
principal and the audit actor in one call, so the authorization subject and the audit actor
cannot disagree.

**Because.** `SECURITY.md § Authorization` requires the policy to be "called by every use case"
and the module to "export the full action list" with "a test asserts every use case is covered".
A convention that each author remembers to call `assertCan` is the same kind of
sentence-not-mechanism that ADR-015 replaced for the audit log, and it fails the same way —
silently, in the one route nobody re-read. Separating the ceiling from the action list is what
lets every later task append a row to `policy.ts` without a security review of that row: the
worst a bad row can do is grant less than the matrix already allows. And two empty ceilings plus
a non-empty-roles invariant turn "EEOC data is visible to no role" and "never sees medical
detail" from prose into a registration that cannot be written — demonstrated above by trying.

**Rejected.** *A bare `assertCan` call at the top of each use case*, which is forgettable and
whose absence no test can see. *Authorization in `proxy.ts`* — `NEXTJS-16.md § 3` forbids
database access there and says in terms that real authorization belongs in
`src/server/auth/policy.ts`. *Authorization in the Server Action only*, per
`CONVENTIONS.md § Server / client boundary` — an action is one of three entry points and the only
one a queue job does not have; that sentence has been amended by one line, and `SECURITY.md`
governs. *Permissions as database rows with an admin UI* — it moves a security decision out of
code review into a screen nobody audits, and no requirement asks for custom roles. *A per-action
role list with no ceiling* — then every future row is a security decision, and the two "no role"
cells are re-argued each time. *Registering only actions whose use case already exists* — the
registry would be empty on delivery and the matrix untested.

**Consequence.** Every later task adds one row to `ACTION_POLICIES` and wraps its use case in
`defineUseCase`; `MODULES.md` already says so. A new `DataClass` is a compile error until its
ceiling is declared. A new `UserRole` is denied everywhere until a ceiling lists it. Adding an
exported function to `src/server/**` that is not a use case requires an allowlist entry with a
reason, and the allowlist cannot be written ahead of the file it exempts. `src/app/**` may no
longer import `@/db`, which is `ARCHITECTURE.md § Layers` enforced for the first time. The four
restricted accessors no longer throw for every caller: a boundary that calls `runAsPrincipal` or
`runAsSystem` establishes the audit context they require. A `SYSTEM` actor still cannot call a
guarded use case; T-016 or T-130 will need a `system?: true` field and a new ADR (open
question 21).

*(Checker's note, not part of the decision: `isUseCase` reads a non-enumerable, non-writable,
non-configurable own `policyAction` property. It is ADR-015 § Limit's kind of boundary — it stops
the accident, not a hand-forged object. That is the correct strength for this wall, which is one
of four.)*

### ADR-024 — `AuditedTx` also omits `auditEntry`, so `writeAuditEntry` is the only writer

**Decision.** `AuditedTx` becomes
`Omit<PrismaTransactionClient, 'medicalFile' | 'eeocRecord' | 'auditEntry'> & brand`, and
`writeAuditEntry` widens to an unexported `AuditWriterTx` internally — the same local widening
`src/db/restricted/medical.ts` and `eeoc.ts` already perform.

**Because.** T-013's review left `tx.auditEntry.create` reachable on an `AuditedTx`, so a use case
could write an entry that skips `auditEntryInputSchema` — and therefore skips the check that
`fieldName` carries a column name and never a value, which is the whole of
`SECURITY.md § Audit log`'s "No values are stored in the audit log" — and skips the ambient actor,
which is the whole of ADR-015 § 1. T-014 is the last moment at which no hand-written
`tx.auditEntry.create` exists anywhere: this is where use cases begin.

**Rejected.** *Leaving it as a follow-up*, which is the reasoning ADR-015 already rejected once
for the transaction-client hole — a boundary that holds in three places and silently does not
hold in a fourth is a distinction no later implementor will remember. *A runtime guard inside
`writeAuditEntry`* — it cannot see a caller that never calls it. *A lint rule on `tx.auditEntry`*
— a rule matching a property access on a parameter name is not expressible in
`no-restricted-imports`, which is the only such mechanism this project has.

**Consequence.** `writeAuditEntry` is the only path to `core."AuditEntry"` in application code, so
every entry is zod-validated and ambient-actored. Reads are unaffected — they go through
`prisma.auditEntry`, which is a `CorePrismaClient` and still carries the delegate. The bound is
ADR-015's own § Limit: a compile-time boundary that stops the accident, not the intent. T-130's
retention sweep, which deletes audit rows with the trigger disabled, must do so through `prisma`,
not through a transaction callback.

*(Checker's note on the scope of "application code", verified rather than assumed: the narrowing
is on the **transaction callback**. `prisma.auditEntry.create` remains reachable from inside
`src/db/**`, which is what the Consequence's last sentence already relies on for T-130.
`src/server/**` and `src/app/**` cannot reach it at all — `prismaOutsideDb` and, as of this task,
the `src/app/**` override forbid importing `@/db/prisma` from either. So the claim holds exactly
where it is made.)*

---

## ADR-024 — `AuditedTx` also omits `auditEntry`, so `writeAuditEntry` is the only writer

**Decision.** `AuditedTx` becomes
`Omit<PrismaTransactionClient, 'medicalFile' | 'eeocRecord' | 'auditEntry'> & brand`, and
`writeAuditEntry` widens to an unexported `AuditWriterTx` internally — the same local widening
`src/db/restricted/medical.ts` and `eeoc.ts` already perform.

**Because.** T-013's review left `tx.auditEntry.create` reachable on an `AuditedTx`, so a use case
could write an entry that skips `auditEntryInputSchema` — and therefore skips the check that
`fieldName` carries a column name and never a value, which is the whole of
`SECURITY.md § Audit log`'s "No values are stored in the audit log" — and skips the ambient actor,
which is the whole of ADR-015 § 1. T-014 is the last moment at which no hand-written
`tx.auditEntry.create` exists anywhere: this is where use cases begin.

**Rejected.** *Leaving it as a follow-up*, which is the reasoning ADR-015 already rejected once
for the transaction-client hole — a boundary that holds in three places and silently does not
hold in a fourth is a distinction no later implementor will remember. *A runtime guard inside
`writeAuditEntry`* — it cannot see a caller that never calls it. *A lint rule on `tx.auditEntry`*
— a rule matching a property access on a parameter name is not expressible in
`no-restricted-imports`, which is the only such mechanism this project has.

**Consequence.** `writeAuditEntry` is the only path to `core."AuditEntry"` in application code, so
every entry is zod-validated and ambient-actored. Reads are unaffected — they go through
`prisma.auditEntry`, which is a `CorePrismaClient` and still carries the delegate. The bound is
ADR-015's own § Limit: a compile-time boundary that stops the accident, not the intent. T-130's
retention sweep, which deletes audit rows with the trigger disabled, must do so through `prisma`,
not through a transaction callback.

*(Checker's note on the scope of "application code", verified rather than assumed: the narrowing
is on the **transaction callback**. `prisma.auditEntry.create` remains reachable from inside
`src/db/**`, which is what the Consequence's last sentence already relies on for T-130.
`src/server/**` and `src/app/**` cannot reach it at all — `prismaOutsideDb` and, as of this task,
the `src/app/**` override forbid importing `@/db/prisma` from either. So the claim holds exactly
where it is made.)*

---

## ADR-014 — Platform-owned requirement templates are exempt from agency scoping

**Decision.** `RequirementTemplate.agencyId` and `AcceptedEvidence.agencyId` are nullable. Null
means the row is platform reference data — a `STATE`, `SERVICE_TYPE` or `PAYER` rule Credora ships
and every tenant reads. `agencyId` non-null means the `AGENCY` layer, and the
`RequirementTemplate_layer_matches_scope` CHECK makes the database agree, so there is no third
ownership state and no flag to keep in sync. The exemption is enumerated in
`PLATFORM_OWNED_MODELS` in `src/db/schema-core.test.ts`, which simultaneously asserts that every
*other* core model's `agencyId` is `NOT NULL`.

**Because.** `DATA-MODEL.md` invariant 5 says every row is agency-scoped. A state requirement is
not tenant data: forcing it into a tenant means one copy per agency, diverging silently, with no
way to ship a correction when New York changes a rule. The tenancy guarantee is preserved where it
actually bites — the repository signature is unchanged (`agencyId` first), every read is
`WHERE "agencyId" IS NULL OR "agencyId" = :agencyId`, there is still no unscoped read, and a write
with `agencyId = null` is reachable only from the seeder (T-033), never from a use case.

**Rejected.** *One copy of every platform rule per agency* — the divergence and the un-shippable
correction above. *A separate `PlatformRequirementTemplate` model* — two tables with identical
columns that `resolve.ts` would have to union, and the `key`/`version` identity would have to be
unique across both anyway. *Leaving the existing assertion as-is* — it checked only that the
field's type is `String`, so it would have passed `agencyId String?` on any model silently; that
hole is the reason the allowlist and the non-optional assertion were added together.

**Consequence.** Two models in `core` now carry a nullable `agencyId`, and adding a third is a
test failure rather than a diff. `RequirementInstance` (T-032) cannot reach `RequirementTemplate`
through the composite `[agencyId, …]` tenancy key every `Caregiver` child uses, because a platform
template has no `agencyId` to match — its FK is a plain `templateId`, and its tenancy comes from
its composite FK to `Caregiver`. `AcceptedEvidence.agencyId` is a denormalised copy of its
parent's with nothing keeping the two in step (raised in the plan's § Risks 10, not resolved
here).

*(Checker's note, verified rather than assumed. Two claims in § Because are written in the present
tense but are **commitments on a repository that does not exist yet**: this task ships no file in
`src/db/repositories/` and no mapper, so "the repository signature is unchanged" and "every read is
`WHERE "agencyId" IS NULL OR "agencyId" = :agencyId`" bind whoever writes the first one — T-031 or
T-033. What **is** shipped and was verified: the nullable columns, the layer CHECK that makes
ownership single-valued, and the `PLATFORM_OWNED_MODELS` allowlist, whose both directions I
mutation-tested — making an unlisted core model's `agencyId` optional, and a listed model's
non-optional, each turn the assertion red. The § Rejected claim about the old assertion is also
accurate: it read `agencyId?.type`, and the schema parser strips `?` into a separate `isOptional`
flag, so `agencyId String?` passed it on any model.)*

## ADR-019 — Medical content lives in keyed answer rows; EEOC has no per-caregiver reader  (2026-09-23, T-011)

**Decision.** The medical store is three tables. `MedicalFile` is a root row with no content.
`MedicalAnswer` holds all clinical content as rows keyed by section and a stable `questionKey`.
`MedicalScreeningResult` holds the item, the pass/fail outcome and the date (`resultedOn`,
date-only), and nothing else. The only read that leaves the store is a projection of the outcome
table. The EEOC store exposes a writer, a boolean `hasEeocResponse`, an agency-wide count and a
delete. No function returns one caregiver's EEOC answers.

**Because.** PRD § Data model allows only the clearance pass/fail out of the medical store, and
no role may view an individual's EEOC data. If the table read for results physically holds
nothing else, widening that read becomes a schema change instead of a forgotten `select`.

**Rejected.** *A column per medical question*: it invents a clinical form and needs a
migration for every new question. *A `Json` blob*: it is untyped, cannot be constrained, and
carries values. *A per-caregiver EEOC reader*: SECURITY.md says EEOC is visible to no role.

**Consequence.** Clinical detail cannot be queried or computed on outside the store, and a
numeric answer is stored as text. The audit `fieldName` names a field group
(`screeningResults`, `medicalHistoryAnswers`, …), not a column. Any new EEOC reader, including
T-140's aggregate (which lives in `eeoc.ts`, with its below-5 rule in `src/domain`), must
change `accessor-surface.test.ts` on purpose. `recordMedicalScreeningResult` does not create
the `MedicalFile` root, so T-083 decides whether recording a result creates it. Uploaded
clinical evidence still lands in `core` as an `UploadedDocument` (OPEN-QUESTIONS #22).

## ADR-029 — Recurrence is a `JobSchedule` row that enqueues its latest due occurrence; missed windows are skipped  (2026-09-23, T-018)

**Decision.** Recurrence lives in a separate `core` model, `JobSchedule`, which holds a cursor
(`nextOccurrenceAt`) and a fixed interval in seconds. `JobState` gains a terminal state,
`CANCELLED`. Each tick enqueues one job for the most recent due occurrence, keyed by
`(scheduleKey, occurrence time)`, and only then advances the cursor with a compare-and-set.
Occurrences missed while the app was down are skipped and counted in `skippedOccurrences`, not
replayed. `claimJobs` is untouched, because its `state IN (PENDING, RUNNING)` allowlist already
excludes `CANCELLED`.

**Because.** Replaying missed windows would send a caregiver a burst of identical messages
after an outage. Enqueueing before advancing means a crash mid-tick repairs itself on the next
tick, and the idempotency key stops a duplicate. A job that reschedules itself would make its
attempts and its attempt log ambiguous.

**Rejected.** A cron library. A job that reschedules itself (a recurrence column on `Job`).
Catch-up replay, including as an option. An `isActive` column (`stopSchedule` deletes the row
instead). `SKIP LOCKED` for ticks (the compare-and-set is enough). Millisecond intervals.

**Consequence.** `listDueSchedules` is the second deliberately unscoped read in the system.
Nothing runs the tick outside tests until OPEN-QUESTIONS #18 is answered. The runner must tick
before it drains, under a SYSTEM audit context (#21). T-130 must call `stopSchedule` when it
deletes a caregiver.

## ADR-030 — The registry declares every port slot now; an empty slot throws, naming its task  (2026-09-23, T-050)

**Decision.** `src/integrations/registry.ts` declares all eight port slots up front. Asking for
a slot that has no adapter yet throws `PortNotAvailableError`, which names the task that fills
it. Lookup is lazy and memoised.

**Because.** The adapter tasks in later waves each fill an existing line rather than all editing
the same lines. Eager construction would throw as soon as the registry is imported.

**Rejected.** Returning `undefined`. A stub that does nothing and reports success. Omitting
unbuilt slots.

**Consequence.** Each adapter task changes one line. `registry.test.ts` pins both error
messages. Once T-058 lands, a startup check that every port resolves becomes possible.

## ADR-031 — All port env vars are declared up front; `env.ts` checks shape, the registry checks adapter names  (2026-09-23, T-050)

**Decision.** T-050 declares all ten port env vars in `src/lib/env.ts`, each with a default or
marked optional. The zod schema checks only the shape of each value. Whether an adapter name is
valid is decided in `registry.ts`.

**Because.** Otherwise a dozen tasks would each edit the same zod object. ADR-016's rule is
about selection variables, not about each adapter's own settings.

**Rejected.** A `z.enum` of adapter names in `env.ts`. A conditional requirement that
`ANTHROPIC_API_KEY` be set when the `claude` adapter is selected. Adding `SESSION_SECRET` or
`APP_URL` here; those belong to the tasks that need them.

**Consequence.** A mistyped adapter name fails on first use, not at startup. T-054 checks
`ANTHROPIC_API_KEY` in its own factory. URL variables use `z.url({ protocol: /^https?$/ })`,
because `z.httpUrl()` rejects the `localhost` values in `.env.example` and plain `z.url()`
accepts a bare `host:port`.

## ADR-027 — Link tokens are hashed random bearer capabilities, consumed by a conditional update  (2026-09-23, T-022)

**Decision.** An invite or reference link carries a random 256-bit token. Only its SHA-256 is
stored, in `LinkToken`. It is consumed by
`UPDATE … WHERE tokenHash = ? AND purpose = ? AND consumedAt IS NULL AND expiresAt > now`,
so exactly one concurrent redeem wins. Each subject has at most one live token. Redemption goes
through `defineLinkUseCase(purpose, 'inspect' | 'consume', run)`, a second kind of guarded use
case, which runs under `runAsSystem`.

**Because.** Single-use needs a database row. Once the row exists, a signature proves nothing
more and costs a secret to manage. A token holder has no role, so ADR-020's role-based registry
cannot express one.

**Rejected.** An HMAC or JWT, with or without a row. Storing the raw token. Consuming on GET
(link scanners would burn it). A `LINK_HOLDER` role. A separate `UNGUARDED_MODULES` entry for
each consumer.

**Consequence.** `SECURITY.md` no longer says "signed". Audit rows for token holders read
`SYSTEM` with no actor id or IP (OPEN-QUESTIONS #30). Lifetimes are 7 days for an invite and 14
for a reference form (#29). A future link type adds a purpose value, not a new mechanism. T-082
needs its own "already responded" check, and T-044's page goes under `src/app/r/`. The
coverage allowlist is per-module, so a later unguarded export in `link-token.ts` would not be
caught; reviews must check for one.

## ADR-025 — One audited reveal door; the decrypt lint exemption names a file, not a directory  (2026-09-23, T-019)

**Decision.** `readSensitiveField` in `src/db/repositories/sensitive-field.ts` is the only
non-test file besides `crypto.ts` that references `decryptField`. In one `AuditedTx` it selects
one envelope column scoped by the caller's agency, writes a `VIEW` audit entry that carries the
field name and the reason, and only then decrypts. Every attempt is audited, including one for
an absent row and one for another agency's row; both return the same "absent". Its only caller
is the `revealSensitiveField` use case. A source-scan test pins both allowlists, and the
`eslint.config.mjs` exemption names this one file.

**Because.** A security claim that only review enforces is not enforced. With the audit write
and the decrypt in one function, a reveal without a logged reason is impossible below the policy
layer.

**Rejected.** Putting the query in `src/db/mapping/`. Exempting all of `repositories/**`. A
decrypt helper separate from the audit write. Decrypting after commit. A new `REVEAL` audit
verb. Shipping the production action before T-020's sessions exist.

**Consequence.** A second decrypt path needs a lint edit, an allowlist edit and an ADR; T-110 is
the one expected case. A failed decrypt rolls back its own audit row (OPEN-QUESTIONS #34). The
only action shipped is the dev page's `revealDevSsn`. The first staff screen after T-020 writes
the production action by copying it.

## ADR-026 — A staff session is a stateless signed pointer; the principal is rebuilt from the `User` row  (2026-09-23, T-020)

**Decision.** The staff session cookie is an HS256 JWS signed with jose and `SESSION_SECRET`.
Its claims are exactly `sub`, `agencyId`, `iat` and `exp`, and it is parsed strictly. Every
request loads `User` by `(agencyId, id)` and builds the Principal only through
`staffPrincipalFrom`, which refuses inactive and `CAREGIVER` rows. Sign-in applies the same
rule. Passwords are hashed with bcryptjs at cost 12. A session lasts 8 hours from sign-in, with
no sliding renewal.

**Because.** SECURITY.md § Sessions requires jose and argon2 or bcrypt. T-014 requires the
principal to be built from the `User` row, not from the cookie. A cookie that holds only a
pointer and is parsed strictly cannot carry a role. Re-reading the row means a role change or a
deactivation takes effect on the next request.

**Rejected.** A role in the cookie. A `Session` table. scrypt or argon2 (bcryptjs was already
installed). A tenant selector at sign-in. JWE.

**Consequence.** `findUserForSignIn(email)` is a declared exception to DATA-MODEL invariant 5,
next to the ones for jobs (`claimJobs`, `listDueSchedules`) and link tokens. Email is globally
unique (OPEN-QUESTIONS #2), so sign-in cannot be agency-scoped. A stolen cookie stays valid
until it expires unless the user is deactivated. T-023 inserts MFA between the password check
and the cookie in `signInStaff`. T-024 must store emails lower-cased and reject passwords over
72 bytes before calling `hashPassword`. A new claim means amending this ADR and the strict
schema together.

## ADR-028 — Requirement instances are frozen and additive; evidence links through one FK per evidence kind  (2026-09-23, T-032)

**Decision.** A `RequirementInstance` points at one specific template row (one version).
Materialisation only inserts, one row per caregiver and requirement key; it never re-points or
removes. Status follows a pure `(from, to)` table that refuses SATISFIED without linked evidence.
`Evidence` has one nullable FK column per evidence kind, with an exactly-one-source CHECK. Only
`SIGNED_DOCUMENT` exists today. `Evidence_signedDocumentId_fkey` is
`DEFERRABLE INITIALLY DEFERRED`, set in raw SQL by its own migration.

**Because.** A later template version must not change what a caregiver was asked for
(OPEN-QUESTIONS #16), and a satisfied instance with nothing linked is a clearance with no proof.
Postgres checks a `NO ACTION` FK after each cascade statement, not after the whole delete. So
only a deferred FK lets a caregiver delete cascade through documents and evidence, while still
refusing, at commit, to delete a document that evidence references.

**Rejected.** A polymorphic `sourceId`: nothing verifies it, and four of the five target tables
do not exist yet. Re-pointing instances when a template is published. Event-keyed transitions,
since nothing reads the history. `onDelete: Cascade` on the document FK, which would silently
strip evidence from a SATISFIED instance.

**Consequence.** Each later evidence-kind task (T-070, the check tasks, T-090, the attestation
owner) adds a column, widens both CHECKs and adds an `EvidenceSource` arm. Any such FK that a
caregiver delete can reach must be made deferrable in raw SQL. Prisma cannot express
`DEFERRABLE`, so a Prisma-generated change to one of these FKs silently drops it; the
caregiver-delete test is the guard. The caller must still supply the caregiver's resolution
context (state, service type, payer), because nothing stores it yet.

## ADR-032 — Background-check `packageCode` stays an opaque string  (2026-09-23, T-055)

**Decision.** `packageCode` in the background-check port stays an opaque string. It is agency
configuration, read by T-081 and passed to the vendor unchanged.

**Because.** T-050 left it open for this task. DOMAIN.md's only named NY check (CHRC) is not
integrated in V1 and never crosses this port, and the vendor is unknown.

**Rejected.** An enum of NY packages, which would invent vocabulary absent from DOMAIN.md and
encode one vendor's catalogue (INTEGRATIONS Rule 1). An enum naming CHRC, which would suggest
CHRC can reach this port.

**Consequence.** If a product owner later defines named check packages, they go into DOMAIN.md
first, and narrowing the type then breaks no caller.

## ADR-033 — The background-check mock keeps state in memory, is driven by a dev control, and signs its own webhooks  (2026-09-23, T-055)

**Decision.** The mock holds orders in a process-local map. A dev control (`advance`) picks each
outcome, and nothing advances on a timer. It uses no fixtures. It signs deliveries with a
private constant HMAC secret, not with an env var.

**Because.** INTEGRATIONS § Ports says mocks are advanced "by a dev control, never by a timer".
§ Webhooks says mocks sign with the real scheme. Rule 4 requires determinism. The task had no
budget for a migration.

**Rejected.** Persisting mock orders in Postgres: a table for a fake vendor. Outcome fixtures
keyed by subject: a hidden second outcome channel that would retain PII. An env var for the
mock secret: nobody needs to set it, and its only effect would be to let a deployment
misconfigure a fake.

**Consequence.** Mock orders vanish on restart. A dev server holding two module instances
would hold two maps, so T-081 must verify that its dev control, T-058's route and the polling
job reach the same instance. A real vendor adapter brings its own secret env var and its own ADR.

## ADR-034 — Intake form definitions are data declared in code, and requirement template keys decide which sections show  (2026-09-23, T-040)

**Decision.** An intake section is a declarative `FormSection` constant in the owning task's
code. It names the requirement template keys that need it (`requiredBy`). A section is shown
only when the caregiver holds a live (not `WAIVED`) requirement instance for one of those keys.

**Because.** A field is only useful when it binds to a canonical column (T-047, DATA-MODEL
invariant 1), and a new column needs a migration and a deploy. What agencies actually vary is
*which* sections a caregiver sees. That is already data, held in requirement templates that
admins edit without code (T-034). ARCHITECTURE: "Intake asks only for fields that some active
requirement needs."

**Rejected.** Form definitions stored in the database and edited by admins, because a field
with no column is useless, and it would add a second editable rules surface to audit. Zod
schemas embedded in definitions: they cannot cross the Server→Client boundary, and they would
be a second validator beside T-004's. Visibility keyed on state or role directly, which would
duplicate T-031's resolution and drift from the instance set that clearance reads.

**Consequence.** Adding a question is a code change; showing or hiding a section per agency is
a template change. A section whose `requiredBy` keys no template seeds is never shown, so T-033
must seed a key for every intake section. T-042, T-043, T-045 and T-046 now depend on T-033.
History bounds (maximum and minimum entry counts) belong to the engine: a count over the
maximum is `invalid`, a count under the minimum is `missing`.

## ADR-035 — The judge uses `claude-opus-5` with no sampling parameters and no refusal fallbacks  (2026-09-23, T-054)

**Decision.** The Claude judge adapter calls `claude-opus-5`, fixed in the one constant
`JUDGE_MODEL`. It sets no sampling parameters and does not enable server-side refusal
`fallbacks`, so a refusal becomes `UNCERTAIN`. The model the API reports (`response.model`) is
recorded as `modelVersion`. The adapter never retries; the job queue does. The mock remains the
default adapter everywhere.

**Because.** AGENTIC-TASKS asked for "low temperature", but `claude-opus-5` rejects
`temperature` with a 400. The provider must be zero-retention under a BAA, and `claude-opus-5`
is available under ZDR. `claude-opus-5-5` is still at launch status, with ZDR unconfirmed.
Stability comes instead from schema-constrained output, the strict zod parse, and the grounding
check (ADR-036).

**Rejected.** An older model that accepts `temperature`: it gives up judgement quality for a
knob that does not make a single call reproducible anyway. `fallbacks`, because it lets the API
route PHI to a model we did not choose. An env var for the model ID, which nobody asked for.

**Consequence.** AGENTIC-TASKS § Implementation is amended to match. Changing the model is a
one-line change plus a successor to this ADR. Every `JudgeDecision` records the API-reported
model, so decisions from different models stay distinguishable. Selecting `claude` in any
deployment is gated on a signed BAA with zero retention (OPEN-QUESTIONS 46).

## ADR-036 — Judge reasons are grounded quotes, checked verbatim against the input  (2026-09-23, T-054)

**Decision.** The model returns `{ quote, finding }` pairs. The adapter checks each quote
verbatim against the input text, and any quote it cannot find forces the verdict to `UNCERTAIN`.
Both adapters emit each reason as `formatReason(quote, finding)`: `"quote" — finding`.

**Because.** The PRD requires reasons "tied to what it read on the document", and AGENTIC-TASKS
requires that each reason "quotes what it read". Nobody can check a free-text reason.

**Rejected.** Trusting free text, which invites fabricated evidence. API citations, which the
API rejects in combination with structured output.

**Consequence.** A fabricated quote cannot produce `VALID`. The reason strings have a stable
shape that T-073 and the queue UI can rely on. `ports/judge.ts` is unchanged.

## ADR-037 — The document set is a projection of requirement instances  (2026-09-23, T-060)

**Decision.** The documents a caregiver must sign are the `SIGNED_DOCUMENT` accepted-evidence
options on the pinned templates of that caregiver's materialised requirement instances. A
document is identified by the option's `evidenceKey`, and a key that several requirements share
is signed once. Only `NOT_STARTED`, `PENDING` and `EXPIRED` instances ask for a document.

**Because.** OPEN-QUESTIONS 28 allows only one precedence rule. ARCHITECTURE says the engine
"emits only documents some active requirement needs". Instances are frozen (ADR-028).

**Rejected.** A separate document catalogue scoped by state, service type and agency: a second
layering system that can disagree with the requirements engine. Calling `resolveRequirements` at
send time: it bypasses frozen versions and could emit a document for a rule the caregiver was
never given. A `documentKey` column on `RequirementTemplate`: a schema change that cannot
express "PPD result or signed attestation".

**Consequence.** Every signable document must exist as a `SIGNED_DOCUMENT` option in the
template library (T-033). The document key is what joins the set, the generators (T-061,
T-062), the envelope, `SignedDocument.templateKey` and `Evidence` (T-064).

## ADR-038 — The e-sign port carries the whole document set in one envelope  (2026-09-23, T-052)

**Decision.** `createEnvelopeInputSchema` takes a `documents[]` list, each item with a
caller-owned `documentRef`. `esignEnvelopeSchema.documents[]` returns a per-document
`signedPdfKey`. This amends T-050 § 5.2; the method signatures are unchanged.

**Because.** PRD § 2 says "Send all documents in one e-signature envelope". DOMAIN defines an
Envelope as "one e-sign transaction containing the whole document set". `SignedDocument` holds
one `signedPdfKey` per document.

**Rejected.** One PDF per envelope, sending N envelopes, which breaks the bullet. One merged PDF
split by page range afterwards, which is fragile, and the signed copies would no longer be the
documents that were sent.

**Consequence.** T-064 makes one `createEnvelope` call per document set and sets each
`documentRef`. It must write every PDF before creating the envelope, because creation fails if
one is missing.

## ADR-039 — The e-sign mock keeps vendor state as JSON files under `STORAGE_ROOT/_mock-esign/`  (2026-09-23, T-052)

**Decision.** The mock stores each envelope as one JSON file under `STORAGE_ROOT/_mock-esign/`.
It reads only file names that pass a regex, inside that directory.

**Because.** Three contexts touch one envelope: the queue job that creates it, the Next request
for the signing page, and T-064's job that reads it. An envelope id stored in our database also
outlives a dev-server restart.

**Rejected.** An in-memory map: separate processes or module instances would each hold their
own, and a restart would lose envelopes that database rows still reference. This is the risk
ADR-033 accepts for the background-check mock. A Prisma table: a fake vendor's state in the
product database, and every mock test would need Postgres.

**Consequence.** The e-sign mock is the second module that uses `node:fs`. Deleting `/storage/`
resets both stores together. The mock's HMAC secret is a public constant, so T-064 treats a
webhook as a notification only and re-reads `getEnvelope` before recording anything.

## ADR-040 — Dev-only pages may drive a mock adapter directly  (2026-09-23, T-052)

**Decision.** One ESLint block exempts `src/app/dev/**/*.dev.tsx` from `adapterOutsideRegistry`,
and from that rule only. ADR-011 already keeps these pages out of production builds.

**Because.** INTEGRATIONS § Ports gives the e-sign mock a "local signing page" and the
background-check mock a "dev control". Neither is port behaviour, and `adapterOutsideRegistry`
forbids importing an adapter from `src/app`.

**Rejected.** A dev accessor exported from `registry.ts`: a second export in a file many tasks
edit, and a door from production code to mocks. Mock-only methods on the port, which would put
test vocabulary in the contract.

**Consequence.** T-051's `/dev/outbox` and T-081's background-check dev control reuse this
exemption instead of adding an accessor. For T-081, whose mock is in-memory (ADR-033), a page
that imports the mock must be shown to reach the same instance as the registry's.

## ADR-041 — The issuer allowlist belongs to each agency and is matched exactly after normalisation  (2026-09-23, T-077)

**Decision.** `AcceptedIssuer.agencyId` is NOT NULL, and `seedNyAcceptedIssuers` copies the NY
starting list into each agency. A match means the two names are equal after
`normalizeIssuerName` (NFKD, strip marks, lower-case, `&`→`and`, non-alphanumerics→space,
trim), and nothing looser. Entries are retired, never deleted.

**Because.** An allowlist hit skips the judge (AGENTIC-TASKS § Permitted 1), so a false match
lets an illegitimate issuer through unexamined. The PRD calls the list "agency-maintained".

**Rejected.** A platform-owned NY list under ADR-014, which would widen `PLATFORM_OWNED_MODELS`
and leave an agency unable to remove an entry it does not accept. Fuzzy, substring or
token-overlap matching, because each widens the unsafe (false-hit) direction. An aliases column:
a renamed program is a second row. A stored normalised column with a unique index, which would
be a second derivation site.

**Consequence.** An issuer printed with any extra word misses and goes to the judge: more staff
work, never less scrutiny. A correction to the starting list does not reach agencies already
seeded. T-073 records the matched entry's id and name, because retiring rather than deleting
keeps that reference valid.

## ADR-042 — A mock adapter may persist through a `src/db/repositories/*` module  (2026-09-23, T-051)

**Decision.** The messaging mock reaches Postgres only through
`src/db/repositories/sent-messages.ts`, in the same way the queue reaches it through `jobs.ts`.
It never imports Prisma. ARCHITECTURE § Layers now names the queue *and the stateful mocks* as
the parts of `integrations` that persist state.

**Because.** INTEGRATIONS § Ports requires the messaging mock to write "to a `SentMessage`
table", which a developer reads at `/dev/outbox`.

**Rejected.** An in-memory outbox, which is lost on every reload and invisible across the
queue-worker and web processes. Writing through the job log: message bodies are values, and the
log holds identifiers only. An injected store interface, which would be an abstraction with one
implementation.

**Consequence.** `SentMessage` holds plaintext bodies, including one-time codes and raw link
tokens. Only the mock writes it, and no retention rule exists (OPEN-QUESTIONS 57). No generic
send job ships. A job payload holds ids only, so each sending task (T-021, T-044, T-082, T-123)
owns its own handler. The e-sign mock (ADR-039) and background-check mock (ADR-033) chose files
and memory instead; persisting through a repository is permitted, not required.

## ADR-043 — `listOutboxMessages` is a declared unscoped read  (2026-09-23, T-051)

**Decision.** `listOutboxMessages(limit)` reads across agencies. Its only caller is
`src/server/dev/outbox.ts`, which is listed in `UNGUARDED_MODULES`, and whose only caller is a
`.dev.tsx` page with no production route (ADR-011). DATA-MODEL § Invariants declares it beside
the ADR-014 and ADR-026 exceptions.

**Because.** DATA-MODEL invariant 5 says "there is no unscoped read", but a developer using the
outbox does not know which agency id a seeded or test flow used.

**Rejected.** An agency picker, which needs an agency list, itself an unscoped read. Putting the
function in `src/db/maintenance.ts`, which names no model.

**Consequence.** Any second non-test caller of `listOutboxMessages` fails review.

## ADR-044 — Webhook agency is resolved through a `WebhookSubject` table, a declared unscoped read  (2026-09-23, T-058)

**Decision.** The webhook route resolves `agencyId` from `(provider, externalId)` before it
persists anything. The `WebhookSubject` row is registered by the task that learned the vendor id,
in that task's own transaction. `findWebhookSubjectAgency` is the third declared exception to
DATA-MODEL invariant 5, after `findUserForSignIn` and `listOutboxMessages`; its only caller is
`src/server/webhooks/receive.ts`, after the signature is verified.

**Because.** Neither the e-sign nor the background-check event carries `agencyId` (T-052,
T-055), `Job.agencyId` is NOT NULL with an FK (ADR-023), and every non-platform core model needs
a NOT NULL `agencyId` (ADR-014).

**Rejected.** A nullable-`agencyId` receipt table (a second schema-test exception, unscoped).
Nullable `Job.agencyId` (NULLs are distinct in ADR-023's unique index). A sentinel platform
agency. Per-provider resolver callbacks registered by T-064/T-081 (the route would import modules
that do not exist). Encoding the agency in the vendor id (a real vendor chooses its ids).

**Consequence.** T-064 and T-081 must call `registerWebhookSubject` in the transaction that
stores the envelope or order, or every callback is answered 409. `externalId` is unique per
provider across tenants; a collision throws at registration instead of misrouting.

## ADR-045 — Webhook receipt: verify before storing, 409 for unknown subjects, dedupe by body hash, two idempotent writes  (2026-09-23, T-058)

**Decision.** Unverified bodies are never stored (401). An unregistered subject gets 409 and is
not stored. A receipt is unique on `(agencyId, provider, SHA-256(rawBody))`; its job key is
`buildIdempotencyKey(type, [receiptId])`. Receipt and enqueue are sequential idempotent writes,
not one transaction. The route runs with no principal; `receive.ts` is in `UNGUARDED_MODULES`
because the vendor's HMAC signature is the authentication.

**Because.** INTEGRATIONS § Webhooks: verify → persist → enqueue → 200 fast. Storing unverified
bodies would be an unauthenticated write path. `enqueueJob` cannot join a transaction. A vendor
redelivers on any non-2xx, which closes the gap between the two writes.

**Rejected.** Storing rejected or unmatched deliveries. Answering 2xx for unmatched (the event is
lost). Dedupe on a vendor event id (neither port's event has one). Widening `enqueueJob` to take a
transaction.

**Consequence.** Until T-064 lands, the mock signing page shows `delivered: HTTP 409`. Two
byte-identical deliveries are one event by definition.

## ADR-046 — The training mock reads committed CSV files as its only fixture; one hand-written parser, no dependency  (2026-09-23, T-057)

**Decision.** `src/integrations/adapters/training/` reads committed CSV fixtures. One catalogue
serves both the scheduled-file import and the API shape. CSV is parsed by a hand-written,
single-line parser (`parseTrainingCsv`); no npm dependency.

**Because.** INTEGRATIONS § Ports asks for a CSV "scheduled file" import that also serves an API
shape; Rule 4 puts fixtures in `adapters/<port>/fixtures/`; no shared fixture loader exists
(T-005), and a JSON-only one cannot read CSV. Two shapes over one platform must not disagree.

**Rejected.** A CSV npm package (accepts multi-line fields and dialects this format forbids).
CSV as TypeScript string constants (a developer cannot drop a real export into `fixtures/`). A
separate JSON fixture for the API shape (a second copy that can drift). A repo-wide fixture
loader (one caller).

**Consequence.** The mock reads a cwd-relative path, so it works from the repo root only. A quoted
field cannot span lines. A real platform with different columns is a new adapter file that reuses
`parseTrainingCsv` only if its format matches.

## ADR-047 — The AlayaCare mock is an out-of-process HTTP server; the in-app adapter is one HTTP client  (2026-09-23, T-056)

**Decision.** `mock-servers/alayacare/` is a standalone `node:http` server, started by
`npm run mock:alayacare` and by tests in-process on port 0. The app's only AlayaCare adapter is
`src/integrations/adapters/alayacare/http.ts`, registered under `ALAYACARE_ADAPTER=mock` and aimed
at `ALAYACARE_BASE_URL`. There is no `adapters/alayacare/mock.ts` and no `fixtures/`; the seed is
`mock-servers/alayacare/seed.ts`.

**Because.** INTEGRATIONS § Ports: "Not an in-process stub — the sync engine must exercise real
HTTP, retries, and idempotency." The state lives in the server, so the seed does too.

**Rejected.** An in-process `mock.ts`. Naming the HTTP client `mock.ts` to satisfy Rule 2
literally. A new `http` registry key (an `env.ts` change for no gain).

**Consequence.** Local sync needs two processes. An unreachable server is a
`VendorUnavailableError`, retried then dead-lettered. INTEGRATIONS Rules 2 and 4 carry a footnote
naming this exception.

## ADR-048 — The AlayaCare wire format is invented until docs exist, and each side owns its wire schemas  (2026-09-23, T-056)

**Decision.** The mock speaks an AlayaCare-flavoured snake_case REST shape with the tenant as a
path prefix and imports nothing from `src/`. The adapter declares its own wire schemas in
`adapters/alayacare/wire.ts`; round-trip tests catch drift.

**Because.** We have no AlayaCare API documentation (OPEN-QUESTIONS). A vendor does not share our
types, and a client importing the server's schemas cannot detect drift.

**Rejected.** One shared `wire.ts` (couples production `src/` to a dev tool; Next would bundle
mock code). Mirroring the port's camelCase shape on the wire (the adapter would translate nothing,
leaving the hardest part untested).

**Consequence.** Real docs mean rewriting `http.ts` and `wire.ts` and updating the mock; the port
and everything above it stand.

## ADR-049 — AlayaCare mock vendor semantics: immutable birthday, 2xx-only idempotent replay, count-based faults  (2026-09-23, T-056)

**Decision.** The mock refuses to change a stored date of birth and reports it as a conflict;
it replays only successful writes for a reused `Idempotency-Key` and refuses a reused key with a
different body; it answers 429 and 503 on a request-count schedule (every 7th / every 11th) when
faults are enabled, never by timer.

**Because.** INTEGRATIONS hard cases: a DOB conflict is "surfaced not overwritten"; the mock
"forces real idempotency keys"; "429 and 503 responses on a fixed schedule". Rule 4 forbids timers
and the wall clock.

**Rejected.** Recording 4xx for replay (a resolved conflict would replay forever). Replaying on a
fingerprint mismatch (hides a caller reusing one key across writes). Time-window rate limiting.
Faults on by default in the factory (tests with seven or more requests would flake).

**Consequence.** T-111 must build one idempotency key per distinct write. A conflict retry
re-asks AlayaCare.

## ADR-050 — Agency documents and attestations are code-declared, versioned templates rendered with pdf-lib standard fonts  (2026-09-23, T-062)

**Decision.** Templates are data in `src/domain/documents/agency-templates.ts`: document key,
string version, title, `signOnly`, and text blocks with `{field}` tokens. One pure renderer handles
them; a hash test fails any content change made without a version bump. `pdf-lib` composes Letter
pages with standard fonts in `src/server/forms/`. An entry whose requirements are all
`ATTESTATION` must use a `signOnly` template that references only the agency, the caregiver's
legal name and the date. An unknown key is refused, never given generic wording.

**Because.** PRD § 2 says "from templates" and "sign-only, with no data entry";
`SignedDocument.templateVersion` must name exactly what was signed; ADR-037 makes the document key
the only join to the template library; no agency wording or PDF masters exist yet.

**Rejected.** A `DocumentTemplate` Prisma model with agency CRUD (migration, admin UI and
versioning for wording nobody has supplied). Filling agency PDF masters (none exist). One
hand-written generator per document (no version guard). A generic fallback for unknown attestation
keys (unapproved legal text). Embedding a Unicode font now (a new dependency).

**Consequence.** Changing wording is a code change plus a version bump. Agency-specific wording
is a distinct document key selected by the requirements engine. Names outside Latin-1 make
standard-font rendering throw; fixing that needs an embedded Unicode font, a dependency and an ADR.

## ADR-051 — The pipeline list view is not audited as a view of each caregiver record  (2026-09-23, T-120)

**Decision.** `getPipelineBoard` writes no `AuditEntry`. `VIEW` entries are written when a single
caregiver record is opened (T-101).

**Because.** SECURITY.md audits views "on a caregiver record"; an `AuditEntry` names one
`entityId`; one entry per row on a board refreshed all day would bury the per-caregiver trail.

**Rejected.** One `VIEW` per listed caregiver (noise, N writes per load). A `PIPELINE` entity
type with a synthetic id (not a record; nobody reads it).

**Consequence.** The board selects no sensitive or restricted field. A task that adds one must add
auditing with it.

## ADR-052 — Capture-once binding is by name: a form field's id is its canonical field's name  (2026-09-23, T-047)

**Decision.** Every intake field id is the name of a canonical record field in one flat catalogue
(`src/domain/forms/canonical-record.ts`), and every intake field is bound. Loading a section
prefills from the record; saving re-runs `validateSection` server-side and writes the bound
columns. Answers hidden by a later answer are cleared on save; sealed (encrypted) blanks are kept.

**Because.** PRD "Capture each field once"; DATA-MODEL invariant 1 (no form model holds a copy);
T-040 made section definitions plain data in `src/domain`, which cannot see Prisma.

**Rejected.** A per-section binding map (a second name for every field, and the place two
sections silently bind one column). A JSON answers blob per section (the copy invariant 1
forbids). Binding typed against Prisma inside section files (layering).

**Consequence.** Section field ids are fixed by the catalogue; a new bindable column is a catalogue
entry checked against its Prisma model by a type test. T-041 asserts `captureOnceIssues` over the
whole flow; each section task asserts `bindingIssues(SECTION)` is empty.

## ADR-053 — Repeating-block rows keep their identity through a reserved `_rowId` answer key  (2026-09-23, T-047)

**Decision.** Each repeating-group row carries its database id in a reserved `_rowId` raw-answer
key. A save diffs rows by id and never deletes and recreates the set. Ids from the browser are
accepted only if they are the caregiver's stored rows; an entry with a blank anchor never creates
or destroys a row.

**Because.** `LinkToken.subjectId` and the `reference.chase:<referenceId>` schedule keys name
`Reference` rows; replacing rows would orphan them.

**Rejected.** Delete-and-recreate (orphans tokens and schedules). Matching by position (removing
the first reference would re-address the second one's link to a different person).

**Consequence.** A reference-form consumer must treat a token whose `Reference` row was deleted as
expired.

## ADR-054 — Seed modules may value-import `src/domain`; the template write moves to a client-parameter writer  (2026-09-23, T-033)

**Decision.** `insertRequirementTemplateVersion`, `publishRequirementTemplateIfChanged` and
`toStoredTemplate` live in `src/db/repositories/requirement-template-writer.ts`, which takes the
client as a parameter and value-imports only `@/domain/`. `publishRequirementTemplate` wraps it in
`runInAuditedTransaction`. Modules loaded by `tsx prisma/seed.ts` may value-import `@/domain/` and
that writer; guard tests enforce it.

**Because.** The seeder runs under `tsx`, which cannot load `server-only`, yet the write path must
be the single derivation site of `scopeKey`/`layer`/`version` (T-030/T-031 reviews).

**Rejected.** A second derivation in the seeder (two encodings that drift). Raw SQL inserts
(bypass zod and the derivation). Making `prisma.ts` tsx-loadable (it needs `env`, which is
`server-only` by design).

**Consequence.** A tsx-loaded module may carry pure `@/domain` imports; anything else still fails
its guard test. The earlier T-132 note "may not import from src/" is superseded for `src/domain`.

## ADR-055 — Training minimums are `RequirementTemplate.minimumMinutes`  (2026-09-23, T-033)

**Decision.** A nullable integer of whole minutes, allowed only on `TRAINING` templates (CHECK and
zod), versioned and frozen with the rule. The same migration tightens the `manualOnlyReason` CHECK
to reject whitespace-only reasons.

**Because.** PRD § 6 "state annual minimums" must be data editable without code (PRD § 4), and
CONVENTIONS stores hours as integer minutes.

**Rejected.** A domain constant keyed by state/service type (code, not data; unversioned; an agency
cannot raise it). A separate `TrainingMinimum` model (a second layering system beside the
resolver, which ADR-037 rejected for documents).

**Consequence.** T-090 reads the minimum from the instance's pinned template. T-034's editor
exposes it for `TRAINING` only.

## ADR-056 — The NY library: service type is the aide service, and agency policy is copied per agency  (2026-09-23, T-033)

**Decision.** `serviceType ∈ {HHA, PCA}` (`src/domain/requirements/vocabulary.ts`). Every platform
template carries `state: 'NY'`, and service-type templates nest under it. Agency-chosen rules (PHI
acknowledgement, background check + FCRA, emergency contacts, EEOC) are `AGENCY`-layer copies
seeded per agency with scope `{agencyId}`; their keys never collide with platform keys.

**Because.** OPEN-QUESTIONS 28 (inclusion precedence); SECURITY "PHI acknowledgement workflow is
an agency-configured requirement"; T-030 Risk 1 (an agency cannot remove a platform rule).

**Rejected.** Un-nested service-type templates (ambiguous under T-031). PHI acknowledgement as a
platform rule (every tenant would get it, BAA workflow or not).

**Consequence.** A new agency gets its defaults only when `seedNyAgencyRequirementTemplates` runs
for it (T-132 for Alvita; a later onboarding flow for others).

## ADR-057 — Caregiver authentication messages are sent synchronously, not queued  (2026-09-23, T-021)

**Decision.** `requestCaregiverCode` and `sendEmailVerification` call `MessagingPort.send`
directly after their transaction commits instead of enqueueing a job. Idempotency keys are still
built with `buildIdempotencyKey`, per issued code or token.

**Because.** A job payload may hold ids only (ADR-042) and only hashes of the code and link token
are stored, so no handler could recover what to send. A code lives 10 minutes and queue backoff
reaches 10 minutes, so a retried send delivers a dead code. The person is waiting on the screen
and a `rejected` outcome must be known before responding. Nothing drains the queue outside tests
yet (OPEN-QUESTIONS 18).

**Rejected.** A handler that mints and stores the code itself (fixes the payload rule, not the
timing). Widening the payload rule for this job (plaintext secrets in `jsonb`).

**Consequence.** An exception to INTEGRATIONS Rule 5, bounded to these two sends. A transient
vendor failure surfaces as "try again", not a retry, and the send is not in `JobAttempt`. A
double-submit of "Send verification link" issues two tokens and sends two emails; the second
supersedes the first.

## ADR-058 — Caregiver sign-in resolves the tenant by mobile phone; ambiguity sends nothing  (2026-09-23, T-021)

**Decision.** `findCaregiversByMobilePhone` is a declared read without `agencyId`, returning ids
only. A code is sent only when exactly one non-withdrawn caregiver holds the number.

**Because.** A caregiver has no tenant selector and no password account, and the invite link is
single-use (ADR-027), so re-entry after the short session lapses can only start from the number.

**Rejected.** An agency slug in the URL (no such column; a caregiver will not know it). A
multi-use invite link (contradicts ADR-027). One code per matching record (the person would choose
an agency's record by typing a code).

**Consequence.** `ContactRecord.mobilePhone` gains an index and every writer must store E.164 via
`phoneSchema`. A number shared by two live records cannot sign in until staff correct one.

## ADR-059 — Caregiver session and one-time-code parameters  (2026-09-23, T-021)

**Decision.** A stateless jose HS256 cookie, `aud: 'credora:caregiver'`, carrying only
`caregiverId` and `agencyId`; the principal is rebuilt from the `Caregiver` row per request; 2-hour
absolute lifetime. Codes are 6 random digits, 10-minute TTL, 5 attempts per code, 5 codes per
caregiver per rolling hour; a new code supersedes the old; stored as HMAC-SHA256 under
`SESSION_SECRET` with a domain label.

**Because.** SECURITY § Sessions ("short-lived", "no password"). 10⁶ codes make an unkeyed hash
reversible. 5 × 5 guesses an hour bounds a targeted guess to about 25 × 10⁻⁶ per hour.

**Rejected.** A server-side session table (the row is re-read, so revocation is not needed). A
separate `OTP_SECRET` (a new required secret for no gain over a labelled HMAC). Sliding sessions.

**Consequence.** No env change. Rotating `SESSION_SECRET` also invalidates outstanding codes.

## ADR-060 — Email verification is bound to the address it was sent to  (2026-09-23, T-021)

**Decision.** `ContactRecord.emailVerificationSentTo` and `emailVerifiedAt`; an email is verified
iff the sent-to address equals the current `email` exactly and the timestamp is set.

**Because.** A link sent to an old address must not verify a new one, and the email write path
(T-047) should not have to remember to clear a flag.

**Rejected.** A lone `emailVerifiedAt` (stale after a change unless every writer clears it). The
address on `LinkToken` (a per-purpose column on a shared table).

**Consequence.** A changed email reads `UNVERIFIED` with no extra write. Emails are stored trimmed,
case kept (T-040/T-047), so a case-only edit also un-verifies.

## ADR-061 — Caregiver code requests respond after the phone lookup only; the pending-code cookie is always issued and encrypted  (2026-09-23, T-025)

**Decision.** `requestCaregiverCode` runs `findCaregiversByMobilePhone` and sets an encrypted
(JWE `dir`/`A256GCM`, key derived from `SESSION_SECRET` with a label) pending-code cookie for
every well-formed number. For a single live match it holds a pre-generated code id and the
caregiver's agency; otherwise random ids. The rate-limit check, consent record, code creation
and SMS send run in Next's `after()`, once the response has gone. Every verify refusal shows one
copy, with no attempts-remaining count.

**Because.** Sign-in must not disclose whether a number is registered (OPEN-QUESTIONS 85, a
security defect). Under T-021 the response time, the cookie and the code-screen copy all differed
for registered numbers, and the timing stayed measurable even when rate-limited.

**Rejected.** Padding every response to a fixed floor (vendor latency has an unbounded tail, and
every real sign-in pays the floor). Deferring only the SMS send (the transaction still runs only
for registered numbers). A signed cookie with a decoy agency id (the payload is readable and a
real agency id repeats across probes). Putting the phone in the cookie and resolving it at verify
(moves the timing oracle rather than removing it).

**Consequence.** Amends ADR-057 (c) and its "try again" consequence: the code send is still not
queued, but is no longer awaited by the response, so a `rejected` or transient vendor failure is
not shown; the person asks for a new code. `createOneTimeCode` takes a caller-supplied id. A guess
before the deferred step commits gets the same refusal copy. Residual difference: one indexed
`findMany` returning 0–2 rows. ADR-059 limits unchanged; a probe of a registered number still
texts that caregiver, up to 5 times an hour.

## ADR-062 — A collection whose anchor is unique per caregiver is keyed by the anchor's value; duplicates are rejected at save  (2026-09-23, T-043)

**Decision.** `COLLECTIONS.<name>.keyedByAnchor: true` makes `planSave` match stored rows by the
anchor value instead of `_rowId`, reject a repeated anchor value as `invalid` on the later entry,
and never emit an update that changes an anchor. `CareSettingExperience.years` becomes nullable so
a draft can name a setting first.

**Because.** `@@unique([agencyId, caregiverId, setting])` is a non-deferrable index checked per
row, so ADR-053's id-matched sequential updates fail when two settings are swapped in one save.

**Rejected.** A `unique` flag on the shared form engine (changes the engine for one screen and the
swap still fails at the database). A `DEFERRABLE` constraint (Prisma's `@@unique` cannot express
it; `migrate diff` would report drift). Dropping the index (loses the invariant for every other
writer). Delete-and-recreate the set (a second write path). Keeping `years` NOT NULL (a chosen
setting would vanish on resume).

**Consequence.** ADR-053 row identity still holds for every non-keyed collection. A renamed keyed
row is a new row. Duplicate feedback arrives on Continue, not as the caregiver types.

## ADR-063 — Adapter names are checked at server boot in `instrumentation.ts`; the registry's empty-slot error is retired  (2026-09-23, T-059)

**Decision.** `src/instrumentation.ts` `register()`, on the Node.js runtime only, calls
`assertEveryPortResolves()`, which checks each port's selected name against its slot's adapters
without constructing anything. `resolveAdapter`'s not-implemented branch, `PortSlot.task` and the
`'not-implemented'` reason are deleted.

**Because.** INTEGRATIONS § Env vars: a bad variable "fails the boot loudly rather than at first
use". ADR-031 deferred that for adapter names only while slots were empty; T-058 filled the last.
Vitest, seed and scripts import the registry, so the check cannot run at module scope.

**Rejected.** A module-scope check (breaks every test that stubs an adapter variable). A zod enum
in `env.ts` (membership held in two files, ADR-031). Eager `getPort` for every port (constructs
adapters at boot). Keeping the empty-slot branch (dead code; a new port ships with an adapter).

**Consequence.** Supersedes ADR-030's empty-slot clause and ADR-031's "caught at first use"
consequence. Under `next start` a misconfigured deploy logs a message naming the variable, value
and valid set, and then answers 500 on every request; the process does not exit (OPEN-QUESTIONS
92). `next build` does not run the check.

## ADR-064 — Hep B consent-or-declination and the flu statement are `FORM` requirements whose documents print the recorded choice  (2026-09-23, T-084)

**Decision.** `HEPATITIS_B_VACCINATION` and `FLU_VACCINATION` are reclassified `FORM` in the NY
seed. Non-sign-only templates `HEPATITIS_B_CONSENT_OR_DECLINATION` and `FLU_VACCINATION_STATEMENT`
join `AGENCY_TEMPLATES` and print the choice (and reason) from three new `DOCUMENT_FIELDS`. The
choice is captured beforehand in two intake sections gated by those requirement keys.

**Because.** PRD § 5 ("Hep B consent or declination, flu declination with reason"). ADR-050 serves
an all-`ATTESTATION` entry only with a sign-only template that prints agency, name and date, so
T-033's `ATTESTATION` seeding left both unrenderable, and T-064 fails closed on a key with no
generator.

**Rejected.** Letting sign-only templates print a choice (weakens "no data entry" for every
attestation). A per-key renderer exemption. Choosing on the vendor's signing page (not modelled by
the port; the choice would be nowhere in the record). Two signed alternatives per requirement
(OPEN-QUESTIONS 48).

**Consequence.** The NY attestation-only set is PHI acknowledgement and FCRA. Every non-official
seeded document has a generator, kept so by `src/db/seeds/ny-document-coverage.test.ts`. Re-seeding
publishes v2 of both rules. An envelope cannot be generated until both questions are answered.

## ADR-065 — Vaccination statements are Standard columns on `HomeCareProfile`, value sets CHECKed in SQL  (2026-09-23, T-084)

**Decision.** `hepatitisBChoice`, `fluVaccinationChoice` and `fluDeclinationReason` are `String?`
on `HomeCareProfile`, with CHECKs for both vocabularies and a CHECK that a reason exists only with
`DECLINED`. The domain parses stored strings fail-closed (`toHepatitisBChoice`,
`toFluVaccinationStatement`).

**Because.** DATA-MODEL invariant 1 (one column per answer); T-047 binds only `string | null`
columns as text; COVID status already lives there as Standard; the signed PDF, itself Standard,
prints the same answers.

**Rejected.** The medical store (pointless while the signed copy is Standard, and forces a
restricted read inside document generation). Prisma enums (fail T-047's binding type check). A new
1:1 model for three columns.

**Consequence.** The answers are visible wherever the home-care profile is. The annual flu statement
overwrites last season's answer; the signed PDFs keep the history.

## ADR-066 — A sealed value with no last-4 column shows "on file" through an `IS NOT NULL` projection, read only by `caregiver-record.ts`  (2026-09-23, T-046)

**Decision.** For sealed columns without a `*Last4` (`workAuthorizationNumberEnc`,
`bankRoutingNumberEnc`), the intake loader runs one raw, parameterised `SELECT … IS NOT NULL` per
sealed satellite per section load, in `src/db/repositories/caregiver-record.ts` only.

**Because.** T-047 made a blank sealed field mean "keep", which only works if the form knows a value
is on file. DATA-MODEL forbids an `*Enc` column in a `WHERE`, and T-047 forbids selecting one on
this path.

**Rejected.** Selecting the envelope and testing it in the app (ciphertext leaves Postgres; breaks
`SealedSelect`). `count` with `{ not: null }` (a `WHERE` on the column). Boolean presence columns
(a migration and a second truth). A last-4 for routing or work-authorisation (T-012 refused it).
Always-optional fields (the missing list would lie).

**Consequence.** One extra query per sealed satellite per section load; DATA-MODEL names the single
reader.

## ADR-067 — Work-authorisation "document type" is one stored code combining the I-9 §1 attestation and the kind of number held  (2026-09-23, T-046)

**Decision.** `workAuthorizationType` holds one code from `WORK_AUTHORIZATION_TYPES` that fixes both
the I-9 §1 attestation box and which number (A-Number or I-94) is printed.

**Because.** I-9 §1 needs both, and the form engine gives one controller per dependent field.

**Rejected.** Two columns (a migration, and a pair that can contradict). Free text (T-061 cannot map
it). A foreign-passport option (needs a country-of-issuance column; anyone admitted on a foreign
passport has an I-94; OPEN-QUESTIONS 101).

**Consequence.** `WORK_AUTHORIZATION_TYPES` is the contract T-061 switches over; `visibleWhen` gains
an any-of list.

## ADR-068 — Clinic results are stored under a restricted `clinical` storage kind; the core row carries no clinical content  (2026-09-24, T-070)

**Decision.** A fourth storage kind, `clinical`. An upload whose evidence key is not classified
`PERSONNEL` in `UPLOAD_EVIDENCE_CLASSES` (`src/domain/documents/upload.ts`) is written under
`<agencyId>/<caregiverId>/clinical/`. `UploadedDocument` in `core` holds only id, caregiver, key and
time; the key's kind segment is the only classification. No staff byte-read path exists yet; every
future reader must gate `clinical` keys.

**Because.** DATA-MODEL keeps clinical detail out of the personnel file, and a TB result or physical
PDF is clinical detail (OPEN-QUESTIONS 22). A distinct prefix is what an S3 bucket policy or IAM
condition can enforce, and it costs one enum value. Fail-closed classification means an
agency-added option leaks nothing by default.

**Rejected.** A `medical`-schema document table (`Evidence` would need a foreign key across the
schema boundary). A `clinical` boolean beside the key (two sources for one fact). Encrypting the
bytes (a separate envelope-encryption ADR). Fail-open classification.

**Consequence.** Closes the storage half of OPEN-QUESTIONS 22; T-083 builds no second mechanism.
Staff access to clinical uploads awaits OPEN-QUESTIONS 102. The S3 adapter must isolate
`*/*/clinical/*`.

## ADR-069 — A second decrypt door prints sealed values onto official forms, audited per field in the same transaction, pinned to one importer  (2026-09-24, T-061)

**Decision.** `readSealedFormValues(agencyId, caregiverId, fields, documentKeys)` in
`src/db/repositories/sealed-form-values.ts` selects only the requested envelope columns, writes one
`VIEW`/`CAREGIVER` audit entry per field (`fieldName` the envelope column, `reason` a
system-composed list of document keys), then decrypts, all in one `runInAuditedTransaction` under
the ambient actor. It is lint-exempt by file; `sensitive-field.test.ts` pins it as a `decryptField`
caller, pins its only importer (`src/server/forms/official-forms.ts`), and pins that module's
importers to T-064's send use case.

**Because.** PRD § 2 requires filled W-4, IT-2104, I-9 §1 and direct deposit forms, which print the
SSN, bank numbers and work-authorisation number. SECURITY: "There is no other way to decrypt";
ADR-025 requires an ADR, a lint `ignores` entry and an allowlist entry for any second decrypt. No
person types a reason at send time.

**Rejected.** Reusing `readSensitiveField` (demands a human reason; pinned to the reveal use case).
A decrypt inside `src/db/mapping/` (mapping holds no query). Decrypting in the use case (plaintext
outside the audited transaction). An `EXPORT` entry here (T-064's envelope writes its own). Forcing
a SYSTEM actor (hides who triggered the send; OPEN-QUESTIONS 109).

**Consequence.** Three files reference `decryptField`. Every generated official form that prints a
sealed value leaves one audit row per value; a refused generation still leaves the rows of the
decrypt it performed. Unsigned and signed PDFs hold plaintext and must be protected, and retained,
as blobs (T-130).

## ADR-070 — Official forms are the governments' own blank PDFs, committed verbatim, pinned by SHA-256, filled by AcroForm field name and flattened; forms with no public blank are composed SAMPLE pages  (2026-09-24, T-061)

**Decision.** The W-4 (2026), IT-2104 (2026), I-9 (01/20/25) and LS 54 (12/25) are committed under
`src/server/forms/official/`, hashes pinned in the catalogue and checked by a test that also
verifies every mapped field's name, type and `MaxLen`. The domain computes a field map;
`fill-acroform.ts` fills it with pdf-lib, flattens, and sets subject `<key> v<revision>.<map>`.
`CHRC_102`, the fingerprint questionnaire and the direct deposit election are `RenderedDocument`s
laid out by `composeDocumentPdf`, marked SAMPLE, with no invented legal wording. Values outside
WinAnsi or longer than the box are refused, never altered (the I-9 ZIP box prints the 5-digit ZIP
of a ZIP+4).

**Because.** PRD § 2 says "filled official forms"; `SignedDocument.templateVersion` must name
exactly what was signed; builds and tests must be deterministic and offline. The four forms publish
unencrypted AcroForms. DOH's current CHRC consent is behind a login, and no public questionnaire or
direct deposit blank exists.

**Rejected.** A runtime download (non-deterministic; network in production). Redrawn facsimiles of
forms whose blanks exist. Text at hand-measured coordinates. A third-party re-host of the 2007
CHRC-102. An embedded Unicode font now (a new dependency; OPEN-QUESTIONS 110).

**Consequence.** A form revision is a new asset, a re-verified map and a version bump
(OPEN-QUESTIONS 111). About 1.3 MB of binaries in git, marked binary in `.gitattributes`. Three
documents stay SAMPLE until the agency supplies the real blanks. Caregivers with non-WinAnsi names
cannot receive generated official forms until a font ADR lands.

## ADR-071 — The invite text is a queued job that mints its link when it sends  (2026-09-24, T-044)

**Decision.** `inviteCaregiver` writes the `Invite` and a `caregiver.inviteSms` job (payload
`{ inviteId }`) in the caregiver's own transaction via `enqueueJobInTransaction`; the handler issues
the INVITE token, commits, sends, and records `SENT` / `REJECTED` / `CANCELLED` on the `Invite`.

**Because.** INTEGRATIONS Rule 5 and ADR-042 (ids-only payloads). ADR-027 stores the token only as a
hash, so it cannot be minted at invite time and sent later. An invite row whose job was never
enqueued would be a tracked record with no invite.

**Rejected.** A synchronous send like ADR-057 (the coordinator is not waiting on a code). Minting at
invite and storing the raw token for the handler (defeats ADR-027). Enqueueing after commit (a crash
between the two strands the invite).

**Consequence.** Until a queue runner exists (OPEN-QUESTIONS 18) no invite leaves the building
outside tests. A retried send delivers a fresh link and kills the previous one.

## ADR-072 — The resolution context is stored on `Caregiver` at invite, and the requirement list is built then  (2026-09-24, T-044)

**Decision.** `Caregiver.workState`, `serviceType`, `payer` (strings from `vocabulary.ts`) are set by
the invite; `materialiseRequirementInstances` runs in the invite's transaction, and an ambiguity
refuses the whole invite.

**Because.** T-032 had no home for the resolver context; a caregiver with no instances reads "None
outstanding" on the pipeline board (T-120).

**Rejected.** The address `state` (a different fact). A satellite model (these are hire facts, not
caregiver-entered). Inviting anyway and materialising later (an unsafe empty requirement list).

**Consequence.** An admin's ambiguous template blocks new invites until fixed, with the key named
(OPEN-QUESTIONS 115).

## ADR-073 — `applyPipelineTransition` is the only writer of `Caregiver.stage`  (2026-09-24, T-044)

**Decision.** One repository function (`src/db/repositories/pipeline-transitions.ts`) reads the
stage, calls `transition()`, conditionally updates, and writes the `PipelineEvent` and an
`EDIT`/`stage` audit entry in the caller's transaction.

**Because.** T-015's invariants 1-2 were unenforced (T-015 REVIEW § Follow-ups).

**Rejected.** Each caller writing the three rows itself.

**Consequence.** T-041, T-100, T-111 and T-124 call it; a direct `stage` write is a review failure.

## ADR-074 — SMS consent is first captured by staff at offer acceptance  (2026-09-24, T-044)

**Decision.** The invite form's required checkbox records `ContactRecord.smsConsent`/`smsConsentAt`;
T-021's phone checkbox re-affirms without changing the timestamp; the send re-checks consent.

**Because.** The invite is itself an SMS, sent before the caregiver sees any screen.

**Consequence.** One consent, two capture points. The recorded consent is staff-attested
(OPEN-QUESTIONS 113); T-048 displays it and lets the caregiver withdraw it, which cancels a pending
invite send with `NO_SMS_CONSENT`.

## ADR-075 — The AlayaCare mapping is one versioned JSON document per agency, parsed by a domain schema on every read and write  (2026-09-24, T-110)

**Decision.** `core.AlayaCareMapping { agencyId @id, version, config Json }`; `config` is parsed by
`alayaCareMappingSchema` in `src/domain/sync/`. Writes are whole-document changes guarded by an
optimistic `version`; every successful write is audited as `EDIT` on `ALAYACARE_MAPPING` with no
values.

**Because.** PRD § Technical architecture: "Per-agency field mapping stored as configuration …
configurable by implementation staff without a deploy"; DATA-MODEL `Agency 1─1 AlayaCareMapping`;
two roles may edit it at once.

**Rejected.** Normalised rows per credential code and custom field (two tables and write paths for a
document edited as a unit). A mapping in code or env (needs a deploy). Last-write-wins (silently
drops a concurrent edit).

**Consequence.** The domain schema is the single source of truth; a stored row that no longer parses
fails loudly. `version` is available to T-111's sync log.

## ADR-076 — A mapping source must be Standard tier; restricted and Sensitive data are unmappable by vocabulary, and profile fields are not per-agency  (2026-09-24, T-110)

**Decision.** Two source kinds: `recordField`, over an explicit 12-field allowlist of contact and
home-care-profile fields (`MAPPABLE_RECORD_FIELDS`), and `credential` (number, issued date or
expiry of one `CredentialType`). The vaccination answers (`covidVaccinationStatus`,
`hepatitisBChoice`, `fluVaccinationChoice`, `fluDeclinationReason`) are not mappable while their
health-data status is open (OPEN-QUESTIONS 89/93). The port's profile fields are a fixed projection
owned by T-111. Custom-field targets carry a staff-entered `alayaCareType`, checked against the
source's type.

**Because.** PRD: EEOC is "never synced to AlayaCare"; DATA-MODEL § Storage tiers; SECURITY's single
decrypt door, with no audited reason available on a background sync; INTEGRATIONS Rule 1.

**Rejected.** Deriving the allowlist from `RECORD_FIELDS` by exclusion (a new column would become
mappable silently). Allowing Sensitive fields (a decrypt call site and a product decision,
OPEN-QUESTIONS 117). Staff-remappable profile fields. A `listCustomFields` port method now
(OPEN-QUESTIONS 116).

**Consequence.** The sync has no decrypt call site. Widening the allowlist is a one-line change
pinned by a test and needs this ADR revisited.

## ADR-077 — Sending an envelope is two steps: a guarded use case generates and records it, a system job calls the vendor and registers the webhook subject  (2026-09-24, T-064)

**Decision.** `sendOwnDocumentSet` (caregiver principal) materialises, selects the set, generates
every PDF, records a `PREPARING` `Envelope` with one `EnvelopeDocument` per document (key,
templateVersion, unsigned key), moves INTAKE → SIGNING, writes the EXPORT audit entry and enqueues
`esign.sendEnvelope`. That job calls `createEnvelope` and, in one transaction, records the vendor id
and signing URL and registers the `WebhookSubject`. `webhook.esign` re-reads the envelope from the
vendor and records the signed copies.

**Because.** The generators may run only inside a guarded use case (ADR-069, T-062) and a SYSTEM
job has no principal; INTEGRATIONS Rule 5 forbids awaiting a vendor from a request;
`createEnvelope` needs every PDF written; ADR-044 needs the subject registered with the vendor id;
the template version must survive until the signature returns.

**Rejected.** Calling `createEnvelope` in the action (breaks Rule 5). Generating inside the job
(unguarded decrypt under SYSTEM). Encoding the template version in `documentRef` (vendor-visible).
Looking the version up at signing time (a deploy in between records the wrong version).

**Consequence.** Two core tables; a partial unique index keeps one live or signed envelope per
caregiver. The caregiver sees `preparing` until a worker drains the queue, so both handlers must be
in the production job registry.

## ADR-078 — The caregiver is the only signer, and a signed copy satisfies its requirement instances without review  (2026-09-24, T-064)

**Decision.** One signer, `role: 'caregiver'`. On the provider's `signed`, every instance the
document satisfies gets the signed copy linked and moves to SATISFIED (through PENDING where
needed); `ENVELOPE_COMPLETED` is applied and a refusal of it is accepted. Declined or voided
envelopes store nothing; the caregiver may prepare a new one.

**Because.** OPEN-QUESTIONS 51 named T-064 as the decider; SECURITY delegates signature validity to
the provider; no PRD bullet asks for a countersignature or a review of a signed form; the webhook is
at-least-once.

**Rejected.** An agency countersign (no identified signatory; a staff member on every critical
path). IN_REVIEW for signed documents (nothing to judge). Dropping the record when the stage
transition is refused (a withdrawn caregiver's signed copies would be lost).

**Consequence.** A countersigner later is a signer entry and routing order, no schema change. A
signed document moves clearance directly.

## ADR-079 — Withdrawal cancels no pending job; every worker re-checks the caregiver's stage when it runs  (2026-09-24, T-124)

**Decision.** `withdrawCaregiver` changes the stage (through `applyPipelineTransition`) and nothing
else. It does not cancel queued jobs, void e-sign envelopes or cancel background-check orders. Every
worker that acts on a caregiver ends without side effects when the caregiver is `WITHDRAWN`, as the
invite job already does.

**Because.** Jobs are at-least-once and enqueued by many tasks (T-044, T-064, T-081, T-111);
`Job.payload` is untyped jsonb with no `caregiverId` column; voiding at a vendor is vendor-specific;
a job already leased would escape a cancel of queued rows, so only the run-time check is reliable.

**Rejected.** Cancelling PENDING jobs whose payload names the caregiver (leaky, misses running jobs,
couples T-124 to every job type). A per-job-type "on withdrawal" hook registry (no second caller).

**Consequence.** T-064's send job, T-081 and T-111 each check the stage at run time. An envelope or
order already created stays open at the vendor until staff void it (OPEN-QUESTIONS 126).

## ADR-080 — Intake FORM instances are satisfied by an `Attestation` evidence row once every visible section behind the key has nothing missing; a satisfied section refuses an incomplete save  (2026-09-24, T-041)

**Decision.** A new core `Attestation` model and `Evidence.attestationId` arm. When a save leaves
every visible section behind an intake requirement key with nothing missing, the flow writes an
`Attestation` and links it as `ATTESTATION` evidence, moving the instance to SATISFIED. A section
whose instance is SATISFIED may still be edited but not saved incomplete.

**Because.** ADR-028: SATISFIED needs linked evidence, one FK column per arm under an
exactly-one-source CHECK; T-033 seeded `ATTESTATION` `<KEY>_SUBMITTED` as the only option; T-040:
"section has missing ⇒ not SATISFIED"; there is no SATISFIED → PENDING edge.

**Rejected.** An `Evidence` row with no source column (breaks ADR-028). A SATISFIED → PENDING edge
(rewrites clearance history). Satisfying on every save regardless of `missing`. A per-section
confirm checkbox (OPEN-QUESTIONS 127).

**Consequence.** T-045's restricted sections are settled by the same code. Settlement is not atomic
with the save but is recomputed on every save.

## ADR-081 — The intake flow is one ordered `ALL_SECTIONS` list behind one `/intake/[step]` route; the store that loads and saves a section is chosen in one place, `storeFor`  (2026-09-24, T-041)

**Decision.** `ALL_SECTIONS` in `src/domain/forms/intake-flow.ts` orders every intake section;
`/intake/[step]` renders any of them; `storeFor(section)` in `src/server/intake/flow.ts` picks the
load/save pair (core capture-once, or a restricted store).

**Because.** Four section owners splice in concurrently without editing each other's code;
restricted stores use a separate Prisma client and cannot share T-047's repository or transaction.

**Rejected.** One route per store (a second progress and ordering system). A `kind` on
`FormSection` (T-040's schema is not about storage). Dispatch in the page and the action (two places,
in the app layer).

**Consequence.** A new store is one constant and one `storeFor` branch; the completeness guard,
settlement and missing list stay generic; the order is pinned by a test every splicing task updates.

## ADR-082 — A clinic result's OCR text lives in the medical store; every document's extracted fields live in core  (2026-09-24, T-071)

**Decision.** Core `Extraction` holds every document's fields (the closed `EXTRACTED_FIELD_NAMES`
vocabulary: name, DOB, address, document number, issuer, dates, training time) and confidences.
For a document whose storage key is not of kind `upload` (ADR-068, fail-closed), `Extraction.text`
is null and the text goes to `medical.ClinicalDocumentText` through two audited accessors;
`readExtractionText` is the only reader.

**Because.** ADR-068 forbids clinical OCR text in core without a decision, and a TB result's text is
clinical detail. The judge (T-073) must read that text, so it must be kept. The field vocabulary is
identity and credential metadata that identity matching (T-072) and auto-accept (T-074) must read
without touching `medical`.

**Rejected.** Everything in core (the OPEN-QUESTIONS 22 leak, through text). The whole extraction
of a clinical document in `medical` (a second read path for T-072). Not storing clinical text and
extracting again in T-073 (a second vendor call; judged text could differ). Encrypting the column.

**Consequence.** Five medical-store models; `deleteMedicalFile` deletes clinical text; T-130's
retention must delete `ClinicalDocumentText` in code (no cross-schema cascade). A clinical finding
added to `EXTRACTED_FIELD_NAMES` may not be stored in core without a new ADR.

## ADR-083 — Extraction stores the reading as printed; normalisation is a pure function applied on every read  (2026-09-24, T-071)

**Decision.** `Extraction.fields` is the port's `{ name, value, confidence }[]` verbatim in a `Json`
column parsed on every read. `normaliseFields` (`src/domain/documents/extraction.ts`) turns it into
`NormalisedFields` inside the repository reads; every field carries `asPrinted` and `value`.

**Because.** OPEN-QUESTIONS 45 gave normalisation to this task and T-053 kept it out of the port.
The printed value is the fact; the normalised value is derived deterministically. Staff comparing a
reading to the image need the printed text anyway.

**Rejected.** Normalised columns beside the printed ones (stored twice; a normaliser fix needs a
backfill). Normalising in each adapter (port-contract change). A child table of fields.

**Consequence.** A normalisation fix changes what past readings normalise to, by design; T-073's
decision records its own input hash. No SQL filters by an extracted value.

## ADR-084 — Restricted intake sections reuse the form engine but not the canonical binding; the EEOC form is write-only, with no prefill  (2026-09-24, T-045)

**Decision.** The medical questionnaire and the voluntary EEOC form are ordinary `FormSection`s
rendered and validated by T-040's engine, but saved by their own use cases through
`src/db/restricted/`, selected in `storeFor` (ADR-081) by `restrictedStoreOf(section)`; question ids
are the stored `questionKey`s. The EEOC screen is never prefilled; an all-blank EEOC submission
writes nothing.

**Because.** DATA-MODEL's restricted tier is never joined into a caregiver query; SECURITY: EEOC data
is visible to no role; T-011's accessor allowlist has no EEOC reader.

**Rejected.** Binding restricted fields into T-047's catalogue (medical answers on the caregiver
record path). A separate restricted form renderer. An EEOC read-back for resume (the reader T-011
forbids). A null/null row for a blank submission (a revisit would wipe a real submission).

**Consequence.** The EEOC resume screen is always blank with a "submitted" note; T-140 counts only
caregivers who answered at least one question; a future restricted section must join
`RESTRICTED_INTAKE_SECTIONS` or it routes to the canonical binding and throws.

## ADR-085 — The seeder runs under a seed-only tsconfig that maps `server-only` to Next's empty module  (2026-09-24, T-132)

**Decision.** `npm run db:seed` / `migrations.seed` run
`tsx --tsconfig prisma/tsconfig.seed.json --env-file-if-exists=.env prisma/seed.ts`. The seed
tsconfig maps `@/*` and `server-only` → `next/dist/compiled/server-only/empty.js` (the alias vitest
already uses), so `prisma/seed.ts` may import any server module and uses `prisma` from
`@/db/prisma`. For `prisma/seed.ts` only, this supersedes T-002's "nothing run by tsx may import
from src/", ADR-018's "build your own PrismaClient" and T-012's "seeded *Enc columns stay null".

**Because.** A demo caregiver needs the audited transaction, `applyPipelineTransition` (ADR-073),
the real SSN envelope (no second implementation), the storage port and `hashPassword`, all behind
`@/lib/env` → `server-only`.

**Rejected.** Direct inserts through a seed-built client (a second stage writer, hand-written
events and audit rows). A `paths` entry in the root tsconfig (neuters the Next build's guard).
Installing `server-only` (its non-react-server export throws). A dev HTTP seeding route (a
production-reachable write surface).

**Consequence.** Client-parameter seed modules keep working but are no longer required for new seed
code; the Next build's `server-only` guard is untouched. The seed refuses to run in production.

## ADR-086 — Demo caregivers are produced by the product's own use cases, no further than a built use case can take them  (2026-09-24, T-132)

**Decision.** The seed invites each demo caregiver with `inviteCaregiver` as the seeded coordinator,
then acts as the caregiver through `saveIntakeStep` (which applies `INTAKE_STARTED`, ADR-080) and
`uploadOwnDocument` with the committed extraction fixtures. Stage is never written otherwise.
Nobody is seeded past a stage whose entering use case exists. A rerun skips a caregiver whose phone
is in use (`PHONE_IN_USE`), so the seed is idempotent without deleting anything.

**Because.** ADR-073 (single stage writer); T-015's recorded transitions drive "days in stage";
T-044: an invited caregiver always has its requirement list.

**Rejected.** `createCaregiver` with a `stage` override (a second writer, no events, no instances).
Applying later events directly (legal transitions with nothing behind them). A truncating reset mode.

**Consequence.** The demo grows as later tasks land, each extending `DEMO_CAREGIVERS` through its own
use case. A half-failed first run is recovered by resetting the database. Seeded uploads' extraction
jobs stay queued until a worker drains them.

## ADR-087 — The caregiver's mobile number is not editable in intake  (2026-09-24, T-048)

**Decision.** `CONTACT_SECTION` does not bind `mobilePhone`; the contact panel shows it read-only
with "ask your coordinator".

**Because.** `mobilePhone` is the only sign-in key (ADR-058), verified by the code the caregiver just
typed; an unverified edit could store a number that finds no caregiver, or one another live record
holds, locking them out with no self-service recovery.

**Rejected.** A plain bound field (silent orphaning of sign-in). Re-verifying a new number by code
before saving (a second OTP flow for a rare event, and a new shared-number collision path).

**Consequence.** A caregiver who changes phones needs staff; no staff edit exists yet
(OPEN-QUESTIONS 144; T-122 owns mobile-number correction).

## ADR-088 — A caregiver can withdraw SMS consent, not grant it, from the Contact screen  (2026-09-24, T-048)

**Decision.** `withdrawOwnSmsConsent` sets `smsConsent = false` and `smsConsentAt = null`, audited as
`EDIT`/`smsConsent`. Consent is granted only by T-044's staff attestation or T-021's phone-screen
checkbox.

**Because.** One consent in two columns (ADR-074): a third capture point would be a second consent
path with its own wording; revocation must be as easy as the grant.

**Rejected.** A bound yes/no field (cannot write the timestamp; T-047 excluded it). A consent history
table (the audit log already records each change with actor and time).

**Consequence.** Every sender re-checks consent at send time (a pending invite cancels with
`NO_SMS_CONSENT`); the next code sign-in re-consents.

## ADR-089 — The job worker is a separate long-running process that ticks schedules and drains the queue  (2026-09-24, T-134)

**Decision.** `npm run worker` runs `scripts/worker.ts` under `tsx` with ADR-085's
`prisma/tsconfig.seed.json`. It checks every port resolves, then loops, under a SYSTEM audit
context, `runScheduleTick` then `drainQueue` (limit 10 each) every 5 seconds with a per-process
worker id, until SIGINT/SIGTERM, when it finishes the cycle in hand and exits. Handlers are
registered in exactly one place, `jobRegistry` in `src/server/jobs/handlers.ts`. `tsx` moves to
`dependencies`. Resolves OPEN-QUESTIONS 18 by default.

**Because.** Nothing drained the queue outside tests, so invites never sent, envelopes stayed
PREPARING and documents were never extracted. The PRD names no host, so the default must run on
any host that can run two processes, including a laptop running `next dev`. ADR-085 already
removed the `server-only` obstacle that ruled out a script in T-016.

**Rejected.** Next's `instrumentation.ts` `register()` (ties background work to every web instance
and to `next dev`; a serverless web tier freezes between requests). A platform cron hitting a
protected route (a new production-reachable write surface with its own authentication, latency
equal to the interval, a host-specific schedule for a host nobody has chosen). Installing
`server-only` (its non-react-server export throws). A `dev:all` script (needs a dependency or
non-portable shell syntax).

**Consequence.** Production needs a second always-on process beside the web app; a serverless-only
host reopens this ADR (a cron route calling the same two functions is the fallback). Developers run
`npm run worker` beside `npm run dev`. Every later handler task adds its handler to `jobRegistry`
and its type to `handlers.test.ts`. T-016 § 6/§ 7 and T-018 § 8's prohibitions on a `scripts/*.ts`
poller are superseded.

## ADR-090 — Intake is the identity anchor; each document is matched against intake alone  (2026-09-24, T-072)

**Decision.** `matchIdentity` compares one document's name and DOB with the intake legal name, the
intake's declared other names, and the intake DOB. Documents are never compared with each other.

**Because.** A documented name change makes two genuine documents disagree; only intake says both
names belong to the caregiver. Intake is the canonical record (DATA-MODEL). DOB equality is
transitive, so two documents that each equal intake equal each other.

**Rejected.** Pairwise comparison of every document (flags every legitimate name change; a
document's positional name split is unreliable). A majority vote across documents (the first
document has nothing to vote with).

**Consequence.** Where intake has no middle name, two documents with different middle names both
match. Matching is per document, so T-074 decides per document with no cross-document state. A
caregiver with no intake name matches nothing.

## ADR-091 — Names agree by token sequence over intake's structured parts; the document's split is ignored  (2026-09-24, T-072)

**Decision.** The document name is one normalised token list; intake supplies first/middle/last
token lists; the document must start with intake's first and end with intake's last, with a
tolerant middle. Suffixes are stripped from the document side by `normalizeName`.

**Because.** T-071 splits printed names by position (`Maria De La Cruz` → middle `De La`, last
`Cruz`; `SANTOS JR, MARIA` → last `SANTOS JR`), so a positional comparison fails both. Intake's
parts were typed by the caregiver. T-004 keeps particles so `de la Cruz` never matches `Cruz`.

**Rejected.** Positional first/middle/last equality. An unordered token-set comparison (lets `Cruz`
match `de la Cruz`). Fuzzy/edit-distance matching (not explainable; matches `Maria` to `Mario`).

**Consequence.** `Jr` and `Sr` are indistinguishable except by DOB. A first initial, a dropped
second surname, or a transliteration outside `normalizeName`'s folding goes to staff. A one-word
other name is read as a former last name (OPEN-QUESTIONS 148).

## ADR-092 — ID numbers are not compared in V1 while no requirement accepts an identity-document upload  (2026-09-24, T-072)

**Decision.** Identity matching compares name and DOB only. No evidence key names a driver's
licence, passport or SSN card, and T-072 adds none. Decides OPEN-QUESTIONS 103 for matching.

**Because.** Uploads are accepted only against an instance's `UPLOADED_DOCUMENT` option and
`NY_PLATFORM_TEMPLATES` has none for an identity document; the documents that exist print
certificate numbers with no intake counterpart. Adding identity-document requirements changes what
every NY caregiver must upload — a product decision. The intake SSN is encrypted (ADR-013), so a
comparison would also need an audited decrypt door.

**Rejected.** Adding a `DRIVERS_LICENSE` evidence key and requirement here. An ID-number rule keyed
on an evidence key no template uses (unreachable).

**Consequence.** The PRD's "ID numbers" and "driver's license, passport, SSN card" stay unmet until
OPEN-QUESTIONS 103 is answered; the task that adds an identity-document requirement adds a
`documentNumber` finding to `matchIdentity` and extends `findIntakeIdentity`.

## ADR-093 — The `CHECK_RESULT` evidence arm; manual-only checks satisfied only by a staff record  (2026-09-24, T-076)

**Decision.** A core `CheckResult` (caregiver, `recordedByUserId`, `recordedAt`, no result value)
and an `Evidence.checkResultId` arm, following ADR-028. `recordManualCheck` is the single writer for
manual-only requirements: it moves NOT_STARTED/EXPIRED through PENDING, links the record, then moves
to SATISFIED, in one audited transaction. The `/checks` worklist and the record share
`manualCheckOf` + `manualCheckPath`, which read `manualOnly` only through `satisfactionPath`.

**Because.** PRD § 3 keeps I-9 §2 and the Registry lookup with staff; ADR-028 requires linked
evidence for SATISFIED; T-033 seeded `CHECK_RESULT` as their only option; there is no
NOT_STARTED → SATISFIED edge.

**Rejected.** An `ATTESTATION` row (that arm means a caregiver's submission, ADR-080). A new
NOT_STARTED → SATISFIED edge. A WHERE on `manualOnly` in the repository (a second reader of the
flag). A User FK on `recordedByUserId` (actor ids stay plain, as on PipelineEvent). Recording a
result value (none was asked for; OPEN-QUESTIONS 149/150).

**Consequence.** T-080 and T-081 reuse `createCheckResult` and the arm; a vendor result has no
recording user, so T-081 makes `recordedByUserId` nullable or adds its own column. T-100/T-122 call
`recordManualCheck` rather than rebuild it. The new `Evidence_check_result_source` CHECK sorts
before the signed/uploaded-document checks, so tests expecting those names use a sourceless kind.

## ADR-094 — Opening a caregiver's record writes one `VIEW` entry per render  (2026-09-24, T-122)

**Decision.** `getCaregiverDetail` writes `VIEW`/`CAREGIVER` with no `fieldName` in the transaction
that reads the record. A not-found id writes nothing. A reveal writes its own field-level `VIEW`
(ADR-025).

**Because.** SECURITY.md audits "every view … on a caregiver record", and ADR-051 deferred that
entry to the single-record view. The masked fields disclose only the stored `*Last4`.

**Rejected.** One entry per displayed field (noise; says nothing a reveal does not). Auditing
not-found ids (no record was viewed). De-duplicating re-renders (needs state for no gain).

**Consequence.** The pipeline board link sets `prefetch={false}`. Adding a sensitive or restricted
field to the page needs no new audit, only its own reveal path.

## ADR-095 — Staff repair the invite path: resend creates a new Invite; a mobile correction is an audited edit  (2026-09-24, T-122)

**Decision.** `resendInvite` (under `caregiver.invite`) creates a new `Invite` row and enqueues the
existing `inviteSmsJob`, refusing up front with the send-time rule plus `ALREADY_QUEUED`.
`correctMobilePhone` (under `caregiver.correctMobilePhone`) writes `ContactRecord.mobilePhone` after
an agency-scoped uniqueness check, audited `EDIT`/`mobilePhone`, with no re-verification and
`smsConsent` untouched.

**Because.** ADR-087 made staff the only path to change the sign-in key. The job already re-checks
and supersedes links at send time.

**Rejected.** Re-queuing the old invite (a settled Invite would change its history). OTP
re-verification of the new number (ADR-087). Clearing consent on a number change
(OPEN-QUESTIONS 152).

**Consequence.** A QUEUED invite goes to the corrected number. Invite rows accumulate as history.
A number another agency uses is accepted, which stops that caregiver's sign-in resolving (ADR-058).

## ADR-096 — The staff envelope action is void; a decline is surfaced on the record, not notified  (2026-09-24, T-122)

**Decision.** `voidEnvelope` (under `envelope.void`) voids a SENT envelope at the provider with a
fixed reason and records `VOIDED` through `closeEnvelope`. There is no staff re-prepare and no
decline notification; the record's E-signature section shows Declined or Voided.

**Because.** Signing is in-app (ADR-078), `sendOwnDocumentSet` is `selfOnly`, and OPEN-QUESTIONS
125's default is no notification.

**Rejected.** A staff re-prepare (generates the caregiver's forms under a staff principal; needs its
own policy and audit story). An SMS or email on decline (OPEN-QUESTIONS 125). Forwarding staff free
text as the vendor void reason (may be shown to the signer).

**Consequence.** After a void the caregiver must return to `/sign`; nothing tells them to
(OPEN-QUESTIONS 153).

## ADR-097 — The judge step records one decision per document; an allowlist hit means the judge is not called, and a mock verdict never passes  (2026-09-24, T-073)

**Decision.** `JudgeDecision` (core) holds either the matched accepted issuer (id + name snapshot) or
the judge call (input hash, verdict, confidence, `modelVersion`, reasons), plus the deterministic
staff reasons; empty reasons means the step passes. An allowlist hit short-circuits the judge
entirely; expiry, date plausibility and `manualOnly` are rules; the step outcome is input to T-074,
never an acceptance. `modelVersion === 'mock'` always routes to staff.

**Because.** AGENTIC-TASKS § Permitted 1 ("A hit short-circuits — the judge is never called"),
T-077's obligations, and T-054's review (the mock's issuer rule is weak).

**Rejected.** Calling the judge on a hit too (contradicts the register; OPEN-QUESTIONS 157). Storing
the full `JudgeResult` as `Json` (typed columns let the weekly sample query verdict and model).
Writing the decision onto `RequirementInstance` (T-074 owns the instance). An FK to `AcceptedIssuer`
(name snapshotted instead).

**Consequence.** T-074 reads `findJudgeDecision(...).outcome`. Under the default mock adapter no
document passes this step without an allowlist hit.

## ADR-098 — Judge reasons about a clinic result live in the medical store  (2026-09-24, T-073)

**Decision.** For a document whose storage key is not of kind `upload`, `JudgeDecision.reasons` is
empty and the reasons go to `medical.ClinicalJudgeReasons` through two audited accessors;
`readJudgeReasons` is the only reader.

**Because.** ADR-036 makes every reason a verbatim quote, and for a TB result the quote is clinical
text; ADR-082 keeps clinical text out of core.

**Rejected.** Reasons in core (the ADR-082 leak through quotes). Dropping clinical reasons (the PRD
wants the reasoning attached for staff).

**Consequence.** `deleteMedicalFile` deletes them; T-130 must delete the row per document in code;
who may read them is OPEN-QUESTIONS 102.

## ADR-099 — Redaction removes known caregiver values, every date, every 5+-digit number and every email from all three judge inputs  (2026-09-24, T-073)

**Decision.** Redaction applies to the extracted text, the issuer text and the requirement
description; the input hash covers what was sent.

**Because.** SECURITY § LLM provider constraints; T-030's flag that `RequirementTemplate.description`
reaches the judge.

**Rejected.** Decrypting the SSN/bank number to match them (the only decrypt doors are ADR-025/069;
the patterns catch them anyway). An allow-list of permitted tokens (unworkable over OCR text). An
LLM redactor (not a permitted LLM use).

**Consequence.** The judge sees name-free, date-free text; dates are judged by rules. Over-redaction
only produces more `UNCERTAIN`.

## ADR-101 — Auto-accept is a queued per-document decision after the judge step, recorded with its identity findings  (2026-09-24, T-074)

**Decision.** `autoAcceptDocumentJob` runs once per document, enqueued by the judge job's decision
transaction (or by the extraction job when there is nothing to judge). It combines
`satisfactionPath`, extraction confidence, `matchIdentity` and the judge step outcome in
`autoAcceptOutcome`, and stores `AutoAcceptDecision` (reason codes, both identity outcomes,
`instanceStatusSet`). It moves the instance PENDING → IN_REVIEW → SATISFIED | EXCEPTION in one
transaction, only if it is still `PENDING`; otherwise it records and leaves the instance.

**Because.** PRD § 3 "auto-accept only when … all pass; everything else goes to the staff queue";
the auto-accepted record must be auditable and sampleable; identity is matched against intake,
which can change later (ADR-090), so the finding is snapshotted; `IN_REVIEW` blocks uploads, so the
instance cannot wait there during the judge.

**Rejected.** Recomputing the decision on read (intake and normalisation drift, ADR-083). Columns on
`RequirementInstance` (an instance can have several documents). Moving to `IN_REVIEW` at extraction
(locks out a re-upload while the judge runs). Letting a later passing document lift an `EXCEPTION`
(OPEN-QUESTIONS 164). Advancing the pipeline stage here.

**Consequence.** T-121 and T-075 read `findAutoAcceptDecision`; whichever decision lands first moves
the instance. No task yet fires `DOCUMENT_REVIEW_CLEARED` (logged in T-123's and T-100's notes).

## ADR-102 — "Extraction confident" is overall confidence and every present relied-on field at ≥ 0.9  (2026-09-24, T-074)

**Decision.** Overall confidence and each present relied-on field (name, DOB, issue, completion and
expiry dates) must be ≥ 0.9. Issuer, document number, address and training minutes are excluded.

**Because.** T-071 handed the threshold here; the judge's date rules treat a low-confidence date as a
real one; identity ignores confidence by design (T-072).

**Rejected.** Overall confidence alone (a 0.62 issue date inside a 0.81 document). Every field (an
unused low-confidence address would send good documents to staff). Per-field thresholds (no evidence
to set them).

**Consequence.** The committed PPD fixture always goes to staff; the HHA certificate fixture passes.
The threshold is OPEN-QUESTIONS 163.

## ADR-100 — CHRC is tracked as a `ChrcSubmission` row plus the existing `CHECK_RESULT` arm, recorded by staff on `/checks`  (2026-09-24, T-080)

**Decision.** Recording a submission moves the CHRC instance `NOT_STARTED → PENDING` and writes
`ChrcSubmission` (caregiver, `submittedByUserId`, `submittedAt`), one per caregiver. Recording the
result requires the submission; it writes `createCheckResult` + `linkEvidence('CHRC_RESULT')` and
moves `PENDING → SATISFIED`. The step is explicit in the input; `chrcStepRefusal`/`chrcNextStep`
drive both the worklist and the use case.

**Because.** PRD § 5: "track the DOH fingerprint process from submission to result, as a coordinator
task where no integration exists". ADR-093 made `CheckResult` the CHECK evidence source. A
submission is not evidence, and no row held its date.

**Rejected.** A `CheckResult` for the submission (evidence of nothing). A result-value column
(sensitive tier; OPEN-QUESTIONS 149). A DOH port or adapter. A generic `CheckSubmission` shared with
T-081 (speculative). Inferring the step from the status (a stale click would record a result).

**Consequence.** Staff views call `recordChrcStep`, not re-implement it. A resubmission, backdating
or a DOH reference number needs a schema change (OPEN-QUESTIONS 162).

## ADR-107 — A Credential is a projection of a SATISFIED requirement instance's accepted upload, recorded with normalised values and the requirement's own expiry  (2026-09-24, T-102)

**Decision.** `projectCredentials` maps a SATISFIED instance's accepted document (the one whose
auto-accept satisfied it, else the latest upload) to a `CredentialType` by evidence key (HHA/PCA
certificate, physical exam report, PPD or chest X-ray). Number, issuer and issue date are the
normalised extraction values; expiry is `expiryFor` on the instance's frozen template. `Credential`
gains nullable `instanceId` and `uploadedDocumentId` with a unique `(agencyId, instanceId)`; rows are
`VERIFIED`.

**Because.** PRD § 9: "Record every credential's issuer and expiry date at activation". ARCHITECTURE:
the AlayaCare sync writes credentials derived from satisfied instances. DOMAIN: one expiry mechanism.
Extracted fields are core (ADR-082), so no medical read.

**Rejected.** Storing `asPrinted` (a sync needs the normalised date). Recomputing on every sync read
(ADR-083's on-read rule suits a reading, not a record that was sent). A printed expiry overriding the
validity rule (a second expiry mechanism). Keying by template key (`AIDE_CERTIFICATION` is both HHA
and PCA). `NOT NULL` source columns.

**Consequence.** A requirement with no uploaded evidence never becomes a credential; CNA and CPR have
no source in V1; a later normaliser fix does not change a recorded credential (OPEN-QUESTIONS 165–167).

## ADR-108 — Credentials are recorded once, inside the supervisor's sign-off transaction, by a direct call; no job  (2026-09-24, T-102)

**Decision.** T-101 calls `recordCaregiverCredentials(agencyId, caregiverId, signedOffAt)` in its
sign-off transaction before enqueueing the sync; it writes one `EDIT CAREGIVER credentials` audit
entry. Post-hire expiry, including the annual flu re-ask, is not built.

**Because.** Sign-off is where activation is decided and the sync must see the credentials; jobs
enqueued together are unordered; PRD § 9 puts monitoring after hire out of V1.

**Rejected.** A `credentials.record` job (races the sync). Recording as each instance is satisfied
(many writers for a record the PRD wants at activation). Recording in the sync job (the sync would
own a record it only sends).

**Consequence.** T-101 depends on T-102. The flu re-ask stays an open product question
(OPEN-QUESTIONS 168).

## ADR-105 — The exception queue shows why each EXCEPTION instance failed, never reads the medical store, never shows an extracted value, and writes no audit entry  (2026-09-24, T-121)

**Decision.** An item is the latest document whose `AutoAcceptDecision` set its (still `EXCEPTION`)
instance to `EXCEPTION`, caregiver not withdrawn. It shows the decision's staff reasons, the
snapshotted identity outcomes, `unconfidentReadings` recomputed from the stored extraction, the
`JudgeDecision` basis and staff reasons, and, for a personnel document only, the judge's reasons via
`readJudgeReasons`. For a clinic result the reasons are not read; the item says they are held in the
medical record. Opening the queue writes no `AuditEntry`.

**Because.** PRD § 9: "each flagged document, what failed, and the judge's reasoning". SECURITY.md
keeps medical detail from coordinators and makes every restricted read audited (ADR-098 puts
clinic-result reasons there; OPEN-QUESTIONS 102). ADR-051's reasoning for list views. The instance is
what staff act on (T-123); the document is what explains it.

**Rejected.** One item per document (history rows for an instance already re-flagged). Showing
extracted values (record fields would need per-row VIEW auditing). Reading clinical reasons with a
medical audit entry per load. Copying reasons into core (ADR-098). A staff document-image view.

**Consequence.** Staff decide a clinic result's exception without the judge's words until
OPEN-QUESTIONS 102 is answered (OPEN-QUESTIONS 170). A task that adds an extracted value to the queue
must add auditing. Any new writer of `EXCEPTION` must record a flagging decision or extend
`findFlaggedDocumentRows`.

## ADR-106 — Permanently failed document-review jobs are listed in the exception queue as stalled reviews; retrying them is T-123's action  (2026-09-24, T-121)

**Decision.** A `DEAD` job of type `documents.extract`, `review.judgeDocument` or
`review.autoAcceptDocument` whose document has no `AutoAcceptDecision` and whose instance is still
`PENDING` (caregiver not withdrawn) is listed with its step, attempts and when it stopped. Other dead
jobs, and stalled documents whose instance moved on, are not. `lastError` is not shown.

**Because.** A dead review job otherwise leaves the requirement `PENDING` with no decision, visible to
nobody (T-074, T-016). The coordinator already works this queue; `listJobs` exists for this read.

**Rejected.** A generic dead-letter page for all job types (sync and e-sign failures belong to their
owners). Moving the instance to `EXCEPTION` on dead-letter (a status write from a failure path with no
decision to explain it). A retry button here (T-121 is read-only).

**Consequence.** T-123 adds the retry (`requeueJob`) under its own policy action; a requeued job that
succeeds leaves the list by itself.

## ADR-109 — The weekly sample of auto-accepted records is computed on read, seeded by the ISO week; nothing is scheduled or stored  (2026-09-24, T-075)

**Decision.** The population is the `AutoAcceptDecision`s with no staff reasons and
`instanceStatusSet = SATISFIED`, decided in the last complete ISO week (Monday 00:00 UTC to Monday
00:00 UTC), withdrawn caregivers included. Up to 10 are chosen by bottom-k over an FNV-1a hash of
`weekKey:uploadedDocumentId`. `/sample` shows the identity outcomes and the judge's basis and reasons,
withholds clinic-result reasons (ADR-105), writes no audit entry and records no finding.

**Because.** PRD § 3: "have staff review a sample of auto-accepted records each week". Decisions are
never changed, so a closed week's population is fixed and a pure seeded pick reproduces it without
stored state. ADR-089 prefers no job where none is needed.

**Rejected.** A weekly `JobSchedule` storing its pick (a table and migration for no gain). The current
week (its population still grows). `Math.random` on read. The newest N (not a sample). A findings
table (OPEN-QUESTIONS 176).

**Consequence.** The "<1% later found invalid" target cannot yet be measured in the product. Past
weeks regenerate exactly; changing the sample size or the hash changes past weeks' samples.

## ADR-103 — Clearance readiness is a pure rule over requirement instances: ready only for a non-empty set with no outstanding blocker; the predicate is defined once  (2026-09-24, T-100)

**Decision.** `clearanceReadiness` (`src/domain/requirements/clearance.ts`) returns ready only when the
caregiver has at least one requirement instance and none satisfies `isOutstandingBlocker`
(`blocksClearance && status !== 'SATISFIED'`), exported from `blocker.ts` and shared with
`currentBlocker`. Otherwise `NO_REQUIREMENTS` or `BLOCKING_OUTSTANDING` (in input order). WAIVED is
outstanding. Stage is not an input.

**Because.** ARCHITECTURE: clearance is "every blocking instance is satisfied". DATA-MODEL invariant 2
makes `RequirementInstance.status` the only source of truth. T-120's handoff forbids restating the
predicate. Without the non-empty rule, a caregiver with no instances would read as cleared.

**Rejected.** Restating the filter in `clearance.ts` (two definitions would drift). Deriving readiness
from stage = CLEARANCE (stage is not evidence). Vacuous truth on an empty set. Treating WAIVED as met
(OPEN-QUESTIONS 38).

**Consequence.** T-101 re-reads through `findClearanceSheet` inside its own transaction and calls
`clearanceReadiness`. If OPEN-QUESTIONS 38 is answered "WAIVED is met", only `isOutstandingBlocker`
changes.

## ADR-104 — The clearance screen is its own route under `clearance.view`, reached from a `/clearance` list, reading only core data  (2026-09-24, T-100)

**Decision.** `/clearance/[id]` is backed by `getClearanceSheet` under `'clearance.view'`
(COORDINATOR, SUPERVISOR, AGENCY_ADMIN) and writes one `VIEW` per open (ADR-094). `/clearance` lists
every non-terminal caregiver with readiness, nearest sign-off stage first, reusing
`findPipelineBoardRows` and writing no audit entry (ADR-051). Neither page reads the medical or EEOC
store or shows a storage key.

**Because.** `'caregiver.view'` and `'pipeline.view'` exclude SUPERVISOR, who signs off.
`/caregivers/[id]` carries contact data and reveal controls a supervisor may not have. DATA-MODEL:
"Clearance never needs to read `medical`".

**Rejected.** A section on `/caregivers/[id]` with `caregiver.view` widened to SUPERVISOR. A list of
stage CLEARANCE only (empty until `VERIFICATION_COMPLETED` has an owner). Reading
`MedicalScreeningResult` (OPEN-QUESTIONS 185).

**Consequence.** T-101 adds sign-off to `/clearance/[id]`. Coordinators see requirements on two
screens (T-122's record and clearance). Once stages past VERIFICATION fire, the list can narrow with
no change to the per-caregiver screen (OPEN-QUESTIONS 186).

## ADR-110 — Staff decisions on flagged documents are recorded per document; reject and request re-upload leave the requirement in EXCEPTION and text the caregiver; a waiver is recorded on the instance  (2026-09-24, T-123)

**Decision.** `StaffDocumentDecision` (one per `UploadedDocument`, unique `(agencyId,
uploadedDocumentId)`) records `ACCEPTED`, `REJECTED` or `REUPLOAD_REQUESTED` with `decidedByUserId`,
`decidedAt` and the caregiver-text status (`caregiverNotice`, `noticeSettledAt`). `ACCEPTED` moves
the requirement EXCEPTION → SATISFIED and is the document the credential projects from
(`findCredentialSources` sets `satisfiedInstance`). A return decision leaves the requirement
`EXCEPTION`, sets `caregiverNotice: 'QUEUED'` and enqueues `review.caregiverNotice` in the same
transaction. A waiver moves EXCEPTION → WAIVED and sets `RequirementInstance.waivedByUserId` /
`waivedAt`. No free text anywhere; nothing is sent on accept or waive; the SMS names only the agency
and links to `/documents`.

**Because.** PRD Target workflow: staff handle exceptions. The caregiver's own upload already reopens
an EXCEPTION requirement (T-070). `PENDING` reads "In progress" and would drop the item from staff
view. T-102 needs the accepted document. ADR-042/088 require an ids-only notice job and a consent
re-check.

**Rejected.** Reject via EXCEPTION → PENDING. A typed reason or note (clinical detail in core,
plaintext SMS bodies). Naming the requirement in the text (health information on a lock screen). A
decision row for the waiver. A staff image view (OPEN-QUESTIONS 102). Removing returned items from
the queue.

**Consequence.** The caregiver learns what is needed from the "Needs attention" badge. Staff accept
without seeing the image until OPEN-QUESTIONS 102 is answered (OPEN-QUESTIONS 179).

## ADR-111 — `DOCUMENT_REVIEW_CLEARED` fires from one repository function, in the transaction of every write that can finish document review, and when signing completes  (2026-09-24, T-123)

**Decision.** `applyDocumentReviewCleared(tx, agencyId, caregiverId, actor)`
(`src/db/repositories/document-review.ts`) applies the event when there are instances and no blocking
DOCUMENT instance is outstanding per `isOutstandingBlocker` (WAIVED stays outstanding, OPEN-QUESTIONS
38). Called by auto-accept on SATISFIED, staff accept, waive, and the e-sign webhook after
`ENVELOPE_COMPLETED`. Refusals from `applyPipelineTransition` write nothing and are ignored, so the
call is idempotent.

**Because.** The stage moves only through `applyPipelineTransition` (ADR-073). Uploads are open before
signing finishes, so the last document can be satisfied while the caregiver is still SIGNING.

**Rejected.** Firing only on staff accept. A scheduled sweep. Counting WAIVED as done. Requiring at
least one DOCUMENT instance (a caregiver with none would stall).

**Consequence.** Any future writer of SATISFIED on a DOCUMENT instance must call it in its
transaction. The T-064 signing-completion fixture gained a DOCUMENT requirement.

## ADR-112 — The exception queue lists and retries dead e-signature and caregiver-text jobs as well as review jobs; a retry is `requeueJob` restricted to those types, with no audit entry  (2026-09-24, T-123)

**Decision.** `getExceptionQueue` reads DEAD jobs once and lists stopped reviews (ADR-106), stopped
e-signature steps (`esign.sendEnvelope` matched on `Envelope.id` while PREPARING, `webhook.esign` on
`vendorEnvelopeId` while SENT, caregiver not withdrawn) and stopped caregiver notices on their
returned document. `retryStoppedJob` (policy `exceptionQueue.decide`) requeues only a DEAD job of this
agency whose type is in `RETRYABLE_JOB_TYPES` (the three review types, `esign.sendEnvelope`,
`webhook.esign`, `review.caregiverNotice`).

**Because.** T-016 and T-064 handoffs name T-123. Every listed handler is idempotent on re-run.

**Rejected.** A generic dead-letter page for every type. Retry of any job by id (it could replay a
sync). An audit entry per retry.

**Consequence.** Dead `caregiver.inviteSms`, `sync.*` and `webhook.backgroundCheck` jobs are not listed
here; the caregiver record's invite status, T-111/T-113 and T-081 own those.

## ADR-113 — VERIFICATION_COMPLETED fires from one repository function when the clearance readiness rule holds, in the transaction of every write that can satisfy a requirement  (2026-09-24, T-101)

**Decision.** `applyVerificationCompleted(tx, agencyId, caregiverId, actorUserId)`
(`src/db/repositories/verification.ts`) re-reads with `findClearanceSheet`; if `clearanceReadiness`
is ready it calls `applyPipelineTransition(… 'VERIFICATION_COMPLETED' …)` and ignores refusals.
"Verification complete" means at least one instance and no instance of any type is
`isOutstandingBlocker` (WAIVED is outstanding). Called at the end of `applyDocumentReviewCleared`
(auto-accept, staff accept, waive, e-sign completion), by `recordManualCheck`, and by the CHRC result
branch of `recordChrcStep`.

**Because.** Nothing fired VERIFICATION → CLEARANCE, so no caregiver could reach sign-off. The stage
moves only through `applyPipelineTransition` (ADR-073). ADR-103 already defines readiness once.

**Rejected.** "No outstanding CHECK/TRAINING blocker" (two definitions of done). A scheduled sweep.
Firing from sign-off, or signing off from VERIFICATION. Separate calls beside each
`applyDocumentReviewCleared` caller.

**Consequence.** Every future writer of SATISFIED calls it (T-081, T-082, T-083, T-090). The
Clearance stage means "ready for sign-off" (OPEN-QUESTIONS 190).

## ADR-114 — Sign-off is the CLEARANCE_GRANTED pipeline event plus a SIGN_OFF audit entry, committed with the credentials and the sync job; no sign-off table  (2026-09-24, T-101)

**Decision.** `signOffClearance` (`'clearance.signOff'`, SUPERVISOR only) in one transaction re-reads
readiness, applies `CLEARANCE_GRANTED` with the supervisor as actor, writes `SIGN_OFF` on the
caregiver, calls `recordCaregiverCredentials`, and enqueues `sync.alayacare` with `{ caregiverId }`
keyed `[caregiverId, 'CLEARANCE_GRANTED']`. Refusals return before any write.

**Because.** PRD § 7 asks for identity and time. The event carries who and when for product history;
the audit log carries them for compliance. ADR-108 orders credentials before the sync. T-015 makes
sign-off one atomic use case.

**Rejected.** A `ClearanceSignOff` model. A key of `[caregiverId]` (one sync ever). A credentials job
(races the sync). A typed attestation (OPEN-QUESTIONS 187).

**Consequence.** "Who signed off, when" is read from the event or the SIGN_OFF entry; no screen shows
it yet (OPEN-QUESTIONS 188).

## ADR-115 — The AlayaCare sync job is `sync.alayacare` with payload `{ caregiverId }`, declared in `src/server/sync/alayacare-sync-job.ts`, where T-111 adds the handler  (2026-09-24, T-101)

**Decision.** T-101 exports `ALAYACARE_SYNC_JOB_TYPE` and `AlayaCareSyncPayload` there; T-111 adds the
`defineJobHandler` in the same file and registers it in `jobRegistry`.

**Because.** Payloads carry identifiers only. The house pattern keeps the type constant beside its
handler. The name is already used in ARCHITECTURE.md and T-015.

**Rejected.** A constant in `src/domain/sync`. A stub handler in T-101.

**Consequence.** A running worker dead-letters the job until T-111 lands (`drain.ts` dead-letters an
unregistered type).

## ADR-116 — The AlayaCare sync log is one `AlayaCareSync` row per sync job, holding field names, counts and AlayaCare's id, never values; attempts stay in `JobAttempt`  (2026-09-24, T-111)

**Decision.** Status `RUNNING → SYNCED | CONFLICT | REJECTED`. The row is upserted on `(agencyId,
jobId)` when the job first reaches AlayaCare (`startAlayaCareSync`); `externalId` is recorded as soon
as the profile write is applied (`recordAlayaCareExternalId`); the row is finished on AlayaCare's
terminal answer (`finishAlayaCareSync`). It records the mapping version (0 = none saved), credentials
written, unmapped credential types, unresolved custom-field keys and conflicting field names. A
SYNCED finish writes one EXPORT / CAREGIVER audit entry (SYSTEM) in the same transaction as
`SYNC_COMPLETED`. `jobId` has no FK to `Job`.

**Because.** PRD § 8 asks for a sync log; the queue already logs every attempt; T-113 needs the
conflicts and T-115 the AlayaCare id.

**Rejected.** DATA-MODEL's `SyncJob 1─n SyncAttempt` (duplicates `Job`/`JobAttempt`). A row per vendor
write. Storing `ours`/`theirs` values (a DOB in a second table). A `Caregiver.alayaCareExternalId`
column.

**Consequence.** "Has this caregiver synced" and "what is their AlayaCare id" are read from this log
(`startAlayaCareSync` returns the latest recorded id across the caregiver's rows).

## ADR-117 — AlayaCare idempotency keys derive from `JobContext.jobId`, one per distinct write; conflict and rejection dead-letter at once; transient errors retry on Retry-After  (2026-09-24, T-111)

**Decision.** Keys: profile `sync.alayacare.profile` `[jobId, knownId ?? 'create']`; credential
`sync.alayacare.credential` `[jobId, credentialId]`; custom fields `sync.alayacare.customFields`
`[jobId]`. `VendorUnavailableError.retryAfterMs` becomes `JobOutcome.retryAfterMs`; `conflict` and
`rejected` become `fail`. `credentialId` was added to `SyncSourceCredential` / `MappedCredential` and
stripped before the port call.

**Because.** ADR-049: one key per distinct write; the mock refuses a reused key with a different body.
A conflict is not retried.

**Rejected.** Content-hash keys. Per-attempt keys (a duplicate on every retry). Retrying conflicts.

**Consequence.** A resolved conflict is re-run by requeueing the dead job (same `jobId`, same keys).

## ADR-118 — The sync runs only for SYNCING or ACTIVE caregivers and skips WITHDRAWN ones; success fires SYNC_COMPLETED with no actor; the profile is a fixed projection  (2026-09-24, T-111)

**Decision.** `syncStageAction`: SYNCING/ACTIVE → sync, WITHDRAWN → skip with no side effects,
earlier stages → `fail`. `projectAlayaCareProfile` sends legal first and last name, DOB, email and
mobile phone, no start date; a blank name or missing DOB fails before any vendor call or log row. The
stage moves only after the profile, every mapped credential and the custom fields are applied, via
`applyPipelineTransition(…, 'SYNC_COMPLETED', actorUserId: null)`; an ALREADY_APPLIED or
TERMINAL_STAGE refusal is ignored.

**Because.** ADR-079, ADR-073, the T-015 SYNCING → ACTIVE edge; ADR-076 leaves profile fields to this
task.

**Rejected.** Mappable profile fields. ACTIVE on the profile write alone. Refusing ACTIVE (a lost-lease
redelivery would dead-letter).

**Consequence.** OPEN-QUESTIONS 191–194.

## ADR-119 — The AlayaCare sync attaches each credential's personnel evidence file and an allowlist of signed documents, inside the existing sync job  (2026-09-24, T-115)

**Decision.** A credential's `documentKey` is its evidence file's storage key when the key's kind is
`upload`, else null. Signed documents pass through `ALAYACARE_SIGNED_DOCUMENTS`, an explicit
allowlist in `src/domain/sync/alayacare-sync.ts` that excludes W-4, IT-2104, I-9 §1, direct deposit
and the Hep B and flu statements. Each allowlisted document is uploaded with `uploadDocument`, keyed
`sync.alayacare.document [jobId, signedDocumentId]`, after the credentials and before the custom
fields. A refused upload stops the sync as REJECTED; ACTIVE follows only when every write applied.
Uploads that back no credential are not sent.

**Because.** PRD § 8 "attached documents"; OPEN-QUESTIONS 102 holds clinical files back; ADR-076 sends
no encrypted value, and a PDF printing an SSN or bank number would; OPEN-QUESTIONS 89/93 hold
vaccination answers back; ADR-117 one key per write; ADR-118 Active means everything arrived.

**Rejected.** Every signed document (SSNs and bank numbers in PDFs). A denylist (a new key leaks by
default). A separate documents job (unordered: ACTIVE before the files land). Redacting PDFs. Syncing
every personnel upload, including Sensitive-tier ID photos.

**Consequence.** T-112's preview lists documents through `signedDocumentsForAlayaCare`. A new document
key reaches AlayaCare only by an allowlist edit plus a test row. OPEN-QUESTIONS 196–198.

## ADR-120 — The AlayaCare port's credential carries `issuer`; the invented wire gains `issuer` on both sides  (2026-09-24, T-115)

**Decision.** The port credential, `SyncSourceCredential` and `MappedCredential` add
`issuer: string | null`; the adapter and mock wires add `issuer` beside `number`. Issuer is not a
mappable custom-field part.

**Because.** PRD § 9: "Record every credential's issuer and expiry date at activation and sync it to
AlayaCare"; ADR-107 records the issuer; ADR-048 each side owns its invented wire schema.

**Rejected.** Issuer as a custom field (it belongs to the credential). Folding it into `number`.

**Consequence.** A credential idempotency key used before this change is refused (422) on replay with
the new body; only dev mocks hold such keys, and a mock restart clears them. Real AlayaCare docs may
rename the field; only `wire.ts` and `http.ts` would change.

## ADR-121 — The EEOC report publishes suppressed marginals only, suppressed inside the restricted accessor  (2026-09-24, T-140)

**Decision.** The report returns gender and race/ethnicity marginals over the agency's current
`EeocRecord` rows. Cells of 0–4 are suppressed; complementary suppression then hides the smallest
shown cell (earliest on a tie) until each dimension has no suppressed cell or at least two totalling
5 or more; fewer than 5 respondents withholds every number. The rule is a pure `src/domain` function
invoked inside `readEeocAggregateReport`, so unsuppressed counts never leave `src/db/restricted/`.
The report is a live snapshot; nothing is stored.

**Because.** SECURITY.md: the report "refuses to return a group smaller than 5"; showing N makes a
lone hidden cell recoverable by subtraction; one `groupBy` keeps both marginals on one snapshot.

**Rejected.** Showing zeros (a zero plus the total places everyone else). Primary suppression only
(recoverable by subtraction). Hiding N (recoverable from a fully shown dimension). A cross-tab (mostly
suppressed, more equations). Suppressing in the page (raw counts would reach `src/app`).

**Consequence.** Small homogeneous agencies see little. A period-based or EEO-1-shaped report needs a
new decision. Because no past report exists, deleting an EEOC row rewrites nothing (T-140's half of
OPEN-QUESTIONS 25). Known residuals: OPEN-QUESTIONS 199–201.

## ADR-122 — The background-check mock keeps vendor state as JSON files under `STORAGE_ROOT/_mock-background-check/`; supersedes ADR-033's in-memory clause  (2026-09-24, T-081)

**Decision.** One file per order holding `{ agencyId, orderId, status }`; ids are checked against the
mock-id pattern before any path is built. The dev control is `src/app/dev/background-check/page.dev.tsx`,
which imports the adapter (ADR-040) and posts each advance's signed delivery to our own webhook route.
`advance` is async.

**Because.** ADR-089 runs jobs in `npm run worker`, a separate process; an in-memory order placed by the
order job is invisible to the web process and vice versa, and ADR-033 made same-instance a precondition.

**Rejected.** A Prisma table (a fake vendor's state in the product schema; every mock test needs
Postgres, as ADR-039 argued). Running the order job in the Next process (reopens ADR-089). A registry dev
accessor (ADR-040).

**Consequence.** Mock orders survive restarts; deleting `storage/` resets them with the e-sign mock. The
dev page exists only under `next dev`.

## ADR-123 — `CheckResult.recordedByUserId` is nullable; null means the vendor reported the result  (2026-09-24, T-081)

**Decision.** One evidence arm for every check result. A background check's CLEAR writes a CheckResult
with a null recorder; a staff record (including T-081b's decision) carries the user.

**Because.** ADR-093's consequence: a vendor result has no recording user, and `linkEvidence` needs a
source row for SATISFIED (ADR-028).

**Rejected.** A second column or table for vendor results (a second evidence arm; wider Evidence
CHECKs). A sentinel "system" user id (a fake actor in a column read as a person).

**Consequence.** Readers render a null recorder as "Reported by the vendor"; none exists yet.

## ADR-124 — `BackgroundCheckOrder`: one per caregiver, standard tier, status only  (2026-09-24, T-081)

**Decision.** The row holds the requester, the package code as sent, the vendor order id, the last
reported status and when the result arrived; unique per caregiver and per vendor order id; `@tier
standard`; no report content.

**Because.** T-055 left the orderId → caregiver mapping here; a webhook carries only the vendor id, and
the poll needs it.

**Rejected.** The vendor id on `CheckResult` (exists only once there is a result). A generic check-order
table shared with CHRC (ADR-100). `@tier sensitive` (no ciphertext; masking would hide the worklist).

**Consequence.** A reorder needs a schema change (OPEN-QUESTIONS 206). Retention for these rows is
T-130's.

## ADR-125 — Staff order the background check; the FCRA gate is asserted in the use case and again in the order job  (2026-09-24, T-081)

**Decision.** A coordinator or admin orders from `/checks`. The use case refuses without a signed
`FCRA_DISCLOSURE`; the order job re-asserts it before the vendor call and dead-letters without one.
CLEAR satisfies the requirement with no person involved (calling `applyVerificationCompleted`); CONSIDER
moves it to IN_REVIEW, never to a failure.

**Because.** SECURITY.md's FCRA row; T-055: CONSIDER "is a result for staff, never an auto-fail"; a
signed copy can be deleted between request and job run.

**Rejected.** Ordering automatically on signature (an agency cost and FCRA-sensitive step with no person
choosing it; OPEN-QUESTIONS 202). CONSIDER → EXCEPTION (the exception queue lists documents only).

**Consequence.** T-081b adds the staff decision on IN_REVIEW.

## ADR-126 — The poll is a per-order `JobSchedule`, reconciled through the same path as the webhook  (2026-09-24, T-081)

**Decision.** The order job creates `backgroundCheck.poll:<orderId>`, hourly. Poll and callback both
re-read `getOrder` and move status forward only; a reversed final result dead-letters. A final status, a
withdrawal or a deleted caregiver stops the schedule; nothing is recorded for a withdrawn caregiver.
Because `createSchedule` cannot join the order transaction, a retried order job past REQUESTED ensures
the schedule exists (idempotent, never restarting an ended schedule).

**Because.** The task title's "poll" and PRD "pull status and result"; callbacks can be lost; ADR-079.

**Rejected.** A self-re-enqueueing job (a second scheduling mechanism beside T-016's). One agency-wide
sweep schedule (an unscoped read). Recording a result after withdrawal (not the caregiver's act).

**Consequence.** One schedule row per open order. OPEN-QUESTIONS 205, 207.

## ADR-127 — The vendor package code is `Agency.backgroundCheckPackageCode`, nullable, seeded for Alvita  (2026-09-24, T-081)

**Decision.** Null refuses ordering with `NO_PACKAGE_CODE`. The Alvita seed sets a placeholder only while
the column is null.

**Because.** ADR-032: the code is agency configuration passed to the vendor unchanged.

**Rejected.** An env var (not per agency). A domain constant (vendor vocabulary in code). An admin screen
(nobody asked).

**Consequence.** Changing the code is a database edit until an admin task adds a field (OPEN-QUESTIONS
203).

## ADR-128 — Recording a medical screening result creates the `MedicalFile` root  (2026-09-24, T-083)

**Decision.** `recordMedicalScreeningResult` finds or creates the root before the upsert, like the
other medical writers.

**Because.** ADR-019 left this to T-083; a stored result with no root makes `readMedicalFile` say "no
file".

**Rejected.** A rootless result (two meanings of "has a medical file"). A separate `createMedicalFile`
accessor (new restricted surface for two lines).

**Consequence.** Another agency's id for an existing file now rolls back instead of writing a stray row;
T-011's cross-agency test changed accordingly.

## ADR-129 — A health screening requirement is satisfied only by a supervisor-recorded PASS on an accepted document  (2026-09-24, T-083)

**Decision.** For `PHYSICAL_EXAM`, `TB_SCREENING` and `IMMUNIZATION_RECORD`, auto-accept and staff accept
stop at IN_REVIEW (`acceptedDocumentStatus(templateKey)`). `recordHealthScreeningResult` writes the
result to the medical store, reads it back through `readMedicalClearanceResults` and copies it: PASS →
SATISFIED + `resultedOn` (via `applyDocumentReviewCleared`), FAIL → EXCEPTION. The status table is
unchanged; staff accept of a flagged health document goes EXCEPTION → PENDING → IN_REVIEW in one
transaction (`staffAcceptSteps`).

**Because.** PRD § 5 "result and date". The judge rules on validity, not the clinical outcome. ADR-082
forbids a clinical finding in core `Extraction`; clearance never reads `medical`.

**Rejected.** Recording the result beside an already-SATISFIED instance (sign-off without a result; a
FAIL would revoke). Extracting pass/fail (a clinical finding in core, or a model deciding a clinical
outcome). A CHECK_RESULT evidence option (frozen instances cannot accept a v2 template). `manualOnly`
(means a regulator assigns the step to a person). A new EXCEPTION → IN_REVIEW edge (the auto-accept job
relies on that move being refused to leave a flagged document alone, and T-081's CONSIDER path would
stop throwing on an EXCEPTION instance).

**Consequence.** Health documents are never auto-satisfied or weekly-sampled. A caregiver stays in
DOCUMENT_REVIEW until the supervisor records every health result. A FAIL is not on `/queue`. Future code
that accepts a document uses `acceptedDocumentStatus`, not a literal SATISFIED. OPEN-QUESTIONS 208–211.

## ADR-130 — The passing result's date is a core column, `RequirementInstance.resultedOn`  (2026-09-24, T-083)

**Decision.** One nullable `@db.Date` column, written only on PASS, shown only to roles holding
`medicalResult.view`.

**Because.** DATA-MODEL puts the pass/fail + date needed for clearance in `core` as a requirement
instance; the clearance sheet must not read `medical`.

**Rejected.** A date on `CheckResult` (needs an evidence option). A new core model for one date. Storing
FAIL in core (the status already says not satisfied).

**Consequence.** After a later SATISFIED → EXCEPTION the shown date is the last passing result's until a
new PASS overwrites it.

## ADR-131 — A staff invite is a `STAFF_INVITE` link token; `LinkToken.caregiverId` is nullable, null exactly for that purpose  (2026-09-24, T-024)

**Decision.** `LinkTokenPurpose` gains `STAFF_INVITE`, whose subject is a `User` (`subjectId = userId`, no
FK); a CHECK ties a null `caregiverId` to that purpose. The invite email is a queued job
(`staffUser.inviteEmail`, payload `{ userId }`) that mints the link when it sends. Accepting sets the
first password once, through a consume link use case that writes only while the user is active and has
no password, then signs the user in.

**Because.** ADR-027: "a future link type adds a purpose value, not a new mechanism"; SECURITY § Sessions
names invites as link tokens; only the hash is stored, so the link is minted at send time (ADR-071).

**Rejected.** Token columns on `User` or a `StaffLinkToken` table (a second single-use mechanism). An
admin-chosen initial password (the admin knows it). A `userId` FK (users are never deleted).

**Consequence.** `grantOf` narrows `caregiverId` for caregiver purposes. Token-holder audit rows read
SYSTEM. T-023 must divert MFA at the set-password action's sign-in.

## ADR-132 — An agency keeps at least one active admin who can sign in; the check locks the agency row  (2026-09-24, T-024)

**Decision.** A role change or deactivation that would leave no `AGENCY_ADMIN` who is active and has a
password is refused as `LAST_ADMIN`. The check runs after `SELECT … FOR UPDATE` on the `Agency` row, in
the write's transaction.

**Because.** Only an admin manages users, so an agency without one cannot recover in-product; an invited
admin cannot sign in; without the lock two admins demoting each other both see two admins.

**Rejected.** Forbidding self-demotion (a second rule the last-admin rule already makes safe). Counting
invited admins. SERIALIZABLE isolation (retries everywhere for one rule).

**Consequence.** Every writer of `User.role` / `User.isActive` goes through `applyAccessChange`.

## ADR-133 — Staff-user changes are audited as entity `USER`  (2026-09-24, T-024)

**Decision.** `AuditEntityType` gains `USER`. Invite and resend are EDIT without a field; role,
activation and first password are EDIT with `fieldName` `role`, `isActive`, `passwordHash` (never the
value).

**Because.** The configuration-write precedent (`ACCEPTED_ISSUER`, `ALAYACARE_MAPPING`); role changes
are the most security-relevant configuration.

**Rejected.** Leaving user changes unaudited because they are not a caregiver record.

## ADR-134 — Staff decide a CONSIDER background check: a clear is SATISFIED with a staff CheckResult, a fail is EXCEPTION  (2026-09-24, T-081b)

**Decision.** `adjudicateBackgroundCheck` (`backgroundCheck.adjudicate`, COORDINATOR and AGENCY_ADMIN)
acts only on an `IN_REVIEW` instance whose order is `CONSIDER`. `CLEARED_AFTER_REVIEW` writes a
`CheckResult` recorded by the user, links `BACKGROUND_CHECK_RESULT`, sets SATISFIED and calls
`applyVerificationCompleted` in the same transaction. `FAILED_AFTER_REVIEW` sets EXCEPTION and writes
nothing but the audit entry. Both are final; a failed row stays on `/checks` as "Failed after staff
review".

**Because.** ADR-125 and OPEN-QUESTIONS 204 leave a CONSIDER IN_REVIEW until staff decide; IN_REVIEW →
SATISFIED and IN_REVIEW → EXCEPTION already exist; ADR-129: a person's FAIL is EXCEPTION and core stores
no FAIL value; ADR-113 applies to SATISFIED.

**Rejected.** WAIVED for a fail (means "does not apply", drops the row). Auto-withdrawing the caregiver
(an adverse action FCRA gates behind notices). A CheckResult or new column for a fail (CheckResult is
positive evidence only, ADR-093; the audit entry already holds it). Staying IN_REVIEW with a flag (a
schema change; "undecided" and "failed" look the same to every status reader).

**Consequence.** A failed check blocks clearance as "Needs attention", is not on `/queue`, cannot be
waived there, and nothing reopens it; the caregiver leaves the worklist only by withdrawal. A vendor
result arriving after a staff decision dead-letters (ADR-126). Reversal needs a new task. OPEN-QUESTIONS
218, 219.

## ADR-136 — The first-sync preview is a read-only per-caregiver page built from the sync's own reads; it gates nothing  (2026-09-24, T-112)

**Decision.** `/caregivers/[id]/alayacare`, backed by `getAlayaCarePreview` under `caregiver.view`,
shows `previewAlayaCareSync`, composed of `projectAlayaCareProfile`, `projectAlayaCareFields` and
`signedDocumentsForAlayaCare` over the same repository reads and `toSyncSourceCredential` that
`runAlayaCareSync` uses. Signed documents outside the allowlist are listed as "Not sent". No port call;
one VIEW per open. `/clearance/[id]` signposts it while `hasAgencySyncedToAlayaCare` is false (an
agency's first sync is its first SYNCED `AlayaCareSync` row) and the caregiver is at CLEARANCE or
SYNCING. The sync is not gated.

**Because.** PRD § 8 "a preview of changes before the first sync for each agency"; T-115 asked that the
preview reuse the document allowlist and upload gate, not copy them; ADR-104 keeps SUPERVISOR off
contact data; ADR-094 requires one VIEW per open.

**Rejected.** Gating the first sync on an approval (not in the PRD; holds every activation on an action
nobody is told to take). Diffing against AlayaCare (T-113's conflict work; the port cannot read custom
fields). An inline section on `/clearance/[id]` (gives supervisors contact data, a second VIEW). One
agency-wide page listing several caregivers' values. Copying `personnelDocumentKey`.

**Consequence.** Any change to what the sync sends is what the preview shows. `personnelDocumentKey`
lives only in `src/server/sync/alayacare-source.ts`, on `UNGUARDED_MODULES`. The VIEW is written in a
second short transaction after `findAlayaCareSyncSubject`. OPEN-QUESTIONS 222.

## ADR-135 — The caregiver self-view is read per store through `storeFor`, masked, and never shows EEOC answers or file bytes  (2026-09-24, T-131)

**Decision.** `/record` is a read-only summary built by `viewOwnRecord`, which dispatches each visible
intake section to its store's `summarise` use case via `storeFor` (ADR-081), one call per store. Record
sections are read in one audited transaction; each medical section through `readMedicalAnswers`; EEOC
only through `hasEeocResponse` ("Submitted" / "Not answered"). Sealed numbers are shown as "Ending
<last four>" / "On file" from the presence projection (`sealedOnFile`). Uploads are listed by
requirement and date only (`findOwnUploads`, data class `OWN_RECORD`).

**Because.** PRD: caregivers see their own record and what the agency holds; SECURITY.md: CAREGIVER sees
own medical answers, EEOC is visible to no role, one decrypt path for staff with a reason; DATA-MODEL.md:
restricted stores are never joined into a caregiver query.

**Rejected.** A single "own record" repository query across core, satellites and restricted stores (a
join across the schema boundary). Linking to the intake steps as the only view (edit forms, one screen
per section, sealed numbers only as hint text). A caregiver reveal of sealed numbers (a second decrypt
path). A non-auditing completeness/summary read of `medical` (a weaker door into the restricted store).

**Consequence.** Each `/record` view writes one `VIEW` per restricted section read plus two core
`VIEW CAREGIVER`s. Any new intake store must supply `summarise` on `SectionStore`. The upload list is
`OWN_RECORD` because it never reads bytes; a later download feature must choose its own class (medical
for `clinical` keys). OPEN-QUESTIONS 220, 221.

## ADR-139 — Reference request state and answers live on `Reference`; attempts are a separate log  (2026-09-24, T-082)

**Decision.** `Reference` gains seven columns (request state, escalation and the answers, including
`responseRecordedByUserId`) and `@@unique([agencyId, id])`. Each request sent is a `ReferenceAttempt`
row (channels and outcome) linked by a composite FK with cascade.

**Because.** A reference is checked once, so request and answer are 1-1 with the reference. Intake
updates reference rows by id and writes only its own columns, so the new columns do not collide with it.

**Rejected.** A separate `ReferenceRequest` 1-1 model (a join and a second lifecycle for a relationship
that is always 1-1).

**Consequence.** Deleting a reference in intake deletes its request history. A check already satisfied
keeps its `CheckResult`. OPEN-QUESTIONS 230.

## ADR-140 — One T-018 schedule per reference drives the chase, and the attempt log decides what happens  (2026-09-24, T-082)

**Decision.** `reference.chase:<referenceId>` repeats every `REFERENCE_RESPONSE_WINDOW_HOURS`. Each run
applies `nextChaseStep` (`src/domain/requirements/reference-check.ts`) to the attempt log, never to an
occurrence count. A carrier rejection is a miss at once. Two misses escalate the reference and end the
schedule.

**Because.** PRD § 5 "log attempts, escalate after two misses". The scheduler skips missed occurrences
and a job can be retried, so counting runs would miscount.

**Rejected.** A one-off delayed job per attempt (two job types and a hand-off; losing one job silently
ends the chase).

**Consequence.** A miss is recorded when a run sees it, at most one tick late. A reference whose only
number is refused escalates in one run. When the job escalates or stops from inside an occurrence,
`stopSchedule` cancels that running occurrence's row (`CANCELLED`); the escalation still commits.
Sibling schedules of a satisfied check end on their next tick. OPEN-QUESTIONS 227, 228, 229.

## ADR-141 — An unfavourable reference answer goes to a person; it never fails a caregiver  (2026-09-24, T-082)

**Decision.** `referenceCheckOutcome` puts the `REFERENCE_CHECK` requirement IN_REVIEW on any "no", and
that takes precedence over two favourable answers. Two favourable answers satisfy it; the satisfying
write (`settleReferenceCheck`) calls `applyVerificationCompleted` in the same transaction.

**Because.** The same rule as the background check's CONSIDER (ADR-134): a rules engine must not reject
a person on a third party's word. A supervisor must see the answer before clearance.

**Rejected.** Counting only favourable answers (a "would not recommend" would be invisible whenever two
others said yes).

**Consequence.** Until T-082b, an IN_REVIEW reference check has no in-app resolution other than a
waiver, and it blocks clearance. `REFERENCE_CHECK` is a blocking NY platform requirement, so every
end-to-end walk to CLEARANCE must satisfy it. OPEN-QUESTIONS 230, 231, 232, 243.

## ADR-145 — Before updating a known AlayaCare employee the sync reads it and reconciles field by field; an unchosen difference stops as CONFLICT and a date of birth is never overwritten  (2026-09-24, T-113)

**Decision.** With a known `externalId`, `writeToAlayaCare` calls `findProfile` and runs
`reconcileAlayaCareProfile` (`src/domain/sync/alayacare-conflict.ts`) before any PUT. Per field, in
order: blank on AlayaCare's side keeps ours; blank on our side keeps AlayaCare's; equivalent values (case
and whitespace ignored) keep AlayaCare's; a DOB difference is always a conflict; otherwise a staff choice
decides; failing that, the field is a conflict. Any conflict stops the sync as CONFLICT with no PUT. The
GET runs inside the job's existing `try`, so it retries like any other request.

**Because.** PRD § 8 "instead of overwriting silently". AlayaCare (as modelled, ADR-049) reports only a
birthday conflict, and a PUT replaces every other profile field.

**Rejected.** Relying on vendor-reported conflicts only (names, email and phone overwritten silently).
Treating "we have no value" as a conflict (would stop every linked employee on `startDate`,
OPEN-QUESTIONS 192). Comparing after writing.

**Consequence.** One extra GET per run with a known id. An AlayaCare hire date is now kept rather than
cleared. Mapped custom fields are still overwritten. OPEN-QUESTIONS 239, 240, 241.

## ADR-146 — Staff resolve a conflict with per-field OURS/THEIRS choices stored as field names on the job's `AlayaCareSync` row; a resolution reruns the same dead job and the choices join the profile key  (2026-09-24, T-113)

**Decision.** `AlayaCareSync` gains `keepOursFields` / `keepTheirsFields` (field names only). The profile
idempotency key is `[jobId, known ?? 'create', ...'field:CHOICE']`, unchanged when there are no choices.
`retryAlayaCareSync` writes one EDIT entry per chosen field; a choiceless retry writes none (as
ADR-112). DOB is not choosable (`RESOLVABLE_PROFILE_FIELDS`).

**Because.** ADR-116 (no values stored) and ADR-117 (same jobId, one key per distinct write). The mock
replays a reused 2xx key and refuses one with a changed body.

**Rejected.** Enqueuing a new job (new keys, duplicate credentials). A resolution counter in the key.
Storing the chosen values. Making DOB choosable (the vendor refuses it).

**Consequence.** The row records what staff decided; the audit log records who. The columns are
Prisma's nullable `TEXT[] DEFAULT ARRAY[]` (as `conflictFields`), not `NOT NULL`. If AlayaCare changes a
THEIRS field twice around one job, a redelivery sends a different body under the same key and is
REJECTED (422); staff retry.

## ADR-147 — Linking to an existing AlayaCare employee is a staff action on the one employee matching our last name and DOB; conflict pages read AlayaCare live and never store what they read  (2026-09-24, T-113)

**Decision.** `linkAlayaCareEmployee` (`src/server/sync/alayacare-sync-issues.ts`) re-runs the identity
lookup and requires the id staff saw, records it on the job's row, writes an EDIT entry with
`fieldName: 'externalId'`, and requeues. `getAlayaCareSyncIssue` calls `findProfile` once per render; a
`VendorUnavailableError` becomes "unavailable", any other error reaches `error.tsx`. `/sync` and
`/sync/[caregiverId]` are COORDINATOR and AGENCY_ADMIN only (`alayaCareSync.view` / `.resolve`).

**Because.** OPEN-QUESTIONS 191 (returning hires) left linking to T-113; T-111's handoff routes
re-reading through `findProfile`. ADR-096 is the precedent for a staff use case reading a vendor.

**Rejected.** Automatic linking in the sync (could merge two people). Linking by name alone (the port
cannot). A queued read job for a page render. Caching AlayaCare's values.

**Consequence.** OPEN-QUESTIONS 191's default becomes "No automatic link; staff may link from
`/sync/[caregiverId]`". One live AlayaCare GET per detail render. Whether the linked employee already
belongs to another Credora caregiver cannot be checked (no `external_reference` on the port); staff
confirm by eye.

## ADR-137 — The caregiver role is the highest self-asserted certification, derived at resolution and not stored; it is a fifth scope axis with a ROLE layer between SERVICE_TYPE and PAYER  (2026-09-24, T-036)

**Decision.** `role = caregiverRoleOf(HomeCareProfile.certificationsHeld)` (CNA > HHA > PCA, null when
none; `src/domain/requirements/role.ts`), read by `findResolutionContext`
(`src/db/repositories/requirement-instances.ts`). `SCOPE_AXES` appends `role`, so every existing
`scopeKey` is unchanged. `RequirementLayer` gains `ROLE` (before `PAYER`), `RequirementTemplate` gains
`role TEXT`, and `RequirementTemplate_layer_matches_scope` is re-added under the same name, comparing as
text.

**Because.** PRD § 1: certifications held are a requirements input, and the role must change what intake
asks for before any credential is verified. A scope axis is single-valued. ADR-014 needs AGENCY to stay
the top label.

**Rejected.** A `Caregiver.role` column (a second copy the profile save must keep in step). Verified
`Credential`s (exist only after document review, too late for intake). A multi-valued role axis (breaks
equality matching and the indexed `scopeKey IN (…)` read). No ROLE label (`{role}` alone would be
mislabelled STATE).

**Consequence.** A role template must contain `{state, serviceType}` to override a NY rule (ADR-056);
anything else is an ambiguity. A caregiver holding CNA and HHA matches only CNA templates. T-034's
pickers need a role picker from `CAREGIVER_ROLES` and `ROLE` in the layer display. No role-scoped
template is seeded. OPEN-QUESTIONS 223, 224.

## ADR-138 — A resolution-context change re-points untouched instances; template publishes still do not  (2026-09-24, T-036)

**Decision.** `materialiseRequirementInstances` re-points an instance to a new winner at a **different
scope** only while it is NOT_STARTED with no evidence and no credential (an `updateMany` whose `where`
requires all three). It never re-points to a newer version at the same scope, never touches a started
instance, and never deletes. `saveIntakeSection` runs it after every accepted home-care-profile save,
and signing runs it at send, both with `findResolutionContext`. This refines ADR-028 and
OPEN-QUESTIONS 16 and 37, which keep their defaults: a new version still leaves in-flight instances
frozen, and an instance that no longer applies still stays.

**Because.** At invite no profile exists, so without a re-point no role override of an existing key
could ever take effect.

**Rejected.** Purely additive materialisation (the role axis would be inert for existing keys).
Re-pointing started instances (orphans evidence, could reopen SATISFIED). A second instance per key
(forbidden by the unique key).

**Consequence.** Every caller of materialise with a stored caregiver must pass `findResolutionContext`,
or a role-less context re-points untouched instances back; so must any future path that edits
workState, serviceType or payer. An ambiguous result on a profile save commits the save and leaves
instances unchanged; send then refuses and names the key. OPEN-QUESTIONS 225, 226.

## ADR-142 — The staff TOTP secret is a fifth encrypted column, decrypted in one pinned repository  (2026-09-25, T-023)

**Decision.** Staff MFA is TOTP per RFC 6238 (HMAC-SHA1, 6 digits, 30 s, ±1 step), implemented on
`node:crypto` in `src/lib/totp.ts`. The 160-bit secret is stored as `StaffMfa.totpSecretEnc`
(`encryptField`, `FIELD_ENCRYPTION_KEY`, ADR-013) in a `/// @tier sensitive` model.
`src/db/repositories/staff-mfa.ts` is the third `decryptField` caller: lint-exempt by file name, listed
in `DECRYPT_CALLERS`, and its importers pinned to `session.ts` and `staff-users.ts`.

**Because.** A TOTP check needs the secret itself, so it cannot be hashed; `SECURITY.md`'s "no other way
to decrypt" and ADR-025 require any new decrypt to be named, and `schema-core.test.ts` requires a fifth
encrypted column to be a decision. RFC 6238 is ~40 lines over `createHmac`, and every authenticator app
speaks SHA-1/6/30.

**Rejected.** `otplib`/`speakeasy` (a dependency for 40 lines of a fixed RFC). Storing the secret in
plaintext (a DB read would clone every staff member's second factor). A separate MFA key (a second key
to manage, with the same threat model). Putting the column on `User` (would make `User`
`@tier sensitive` and put ciphertext in the session read's model).

**Consequence.** Rotating `FIELD_ENCRYPTION_KEY` now also strands staff MFA (ADR-013's known gap).
`ENCRYPTED_FIELDS` has five entries; `DECRYPT_CALLERS` three.

## ADR-143 — The second factor sits between the password and the session cookie, in its own short-lived cookie  (2026-09-25, T-023)

**Decision.** A password match for a user who must pass MFA issues `credora_staff_mfa`, an HS256 JWT
with audience `credora:staff-mfa`, strict claims, 10 minutes, `path=/login`. Only an accepted TOTP or
recovery code issues the unchanged ADR-026 session cookie. Attempts are counted before comparison by a
conditional increment; `MFA_MAX_ATTEMPTS` (10) consecutive failures lock the second step until an admin
reset. An accepted TOTP step is recorded and no step at or below it is accepted again. Ten 80-bit
recovery codes per enrolment, stored as unkeyed SHA-256, consumed by conditional update. Enrolment and
admin reset are audited as `USER`/`EDIT` `totpSecretEnc`; verification is not audited.

**Because.** ADR-026 fixes the session claims, so "password done, code pending" cannot live in the
session cookie without widening its strict schema and adding a check to every page. A stateless pending
cookie is replayable, so the attempt limit and replay guard live in the row.

**Rejected.** An `mfa` claim in the session cookie. A server-side pending-login table. Resetting the
counter on each password entry (turns a 10-guess limit into unlimited guesses for anyone with the
password). bcrypt for recovery codes (80 bits needs no stretching; ten bcrypt compares per attempt). An
encrypted pending cookie (it is issued only after a correct password, so there is no enumeration signal
to hide — contrast ADR-061).

**Consequence.** `session.ts` mints the session cookie in three places, all inside that file. A locked
user needs an admin; a locked sole admin needs Credora. OPEN-QUESTIONS 235, 238.

## ADR-144 — MFA is enforced per agency by `Agency.mfaRequired`, on by default, with no screen to switch it off; admins reset a user's MFA  (2026-09-25, T-023)

**Decision.** `Agency.mfaRequired Boolean @default(true)`. An unenrolled user of a requiring agency must
enrol at their next password sign-in (invite acceptance included); an enrolled user is always asked,
whatever the flag. No UI changes the flag. `resetStaffMfa` (`user.manage`, `AGENCY_ADMIN`) deletes a
user's `StaffMfa` and recovery codes.

**Because.** `SECURITY.md § Sessions`: "MFA is an enforced flag per agency"; the PRD says *enforced*,
so the default is on and switching it off is not an admin self-service action. Without an in-product
reset, a lost phone or a lockout needs database access.

**Rejected.** Default off (the PRD requirement would be met only on paper). Per-role enforcement (not
what SECURITY.md says; OPEN-QUESTIONS 233). An admin toggle (OPEN-QUESTIONS 236). A dedicated
`user.resetMfa` action (a new `policy.ts` row for exactly the `user.manage` audience).

**Consequence.** Every existing agency, including the dev database's Alvita, requires MFA from this
migration on; seeded staff enrol at their next sign-in. OPEN-QUESTIONS 233, 234, 236, 237.

## ADR-150 — Staff decide a reference check in review: a satisfy is SATISFIED with a staff-recorded CheckResult; a fail is EXCEPTION, with no record beyond the audit entry  (2026-09-25, T-082b)

**Decision.** `decideReferenceCheck` (`reference.decide`, COORDINATOR and AGENCY_ADMIN), keyed by
caregiver, acts only on a non-withdrawn caregiver's `IN_REVIEW` `REFERENCE_CHECK` with at least one
unfavourable recorded answer. `SATISFIED_AFTER_REVIEW` writes `CheckResult(recordedByUserId = the
user)`, links `REFERENCE_CHECK_RESULT`, sets SATISFIED and calls `applyVerificationCompleted` in the
same transaction (through the same helper as the answer paths). `FAILED_AFTER_REVIEW` sets EXCEPTION.
Both are final. No count of favourable answers is required to satisfy.

**Because.** ADR-141's consequence and OPEN-QUESTIONS 243: only a waiver cleared a check in review.
ADR-134 set the pattern for a person's decision on a third party's adverse report; ADR-113 applies to
SATISFIED. `settleReferenceCheck` never re-runs on an IN_REVIEW check, so a count rule would strand a
check with one "no".

**Rejected.** WAIVED for either outcome (it means "does not apply"). Requiring two favourable answers
to satisfy. Auto-withdrawal on a fail (an adverse action). A schema flag or new column.

**Consequence.** A failed reference check blocks clearance, shows "Needs attention", is not on
`/queue`, and leaves `/checks` only by withdrawal. Reversal or asking for a new reference needs a new
task. OPEN-QUESTIONS 243, 246.

## ADR-153 — The AlayaCare export adapter answers the port as an AlayaCare that can be written but never read  (2026-09-25, T-114)

**Decision.** `createExportAlayaCare` (`src/integrations/adapters/alayacare/export.ts`): `findProfile`
always returns `null`; `upsertProfile` never returns `conflict`, and its reference is the given
`externalId`, or `credora-<caregiverId>` when there is none; `writeCredential` returns
`credentialId: null`; `uploadDocument` returns the relative file path as `documentId`. Idempotency
comes from keyed or deduplicated rows, not from stored keys.

**Because.** PRD § Risks: "fall back to a structured export for manual import". INTEGRATIONS.md: "a
second adapter … against the same port, not a new subsystem". Echoing our own export back through
`findProfile` would make T-113's reconciliation flag Credora's own edits as conflicts.

**Rejected.** Returning the last exported row from `findProfile` (Credora compared with itself).
Throwing from `findProfile` (the job would retry or dead-letter forever). A new port method or a
"read unavailable" arm (a port change for one adapter). Storing idempotency keys (a second state file
the data already makes unnecessary).

**Consequence.** Under the export, conflicts are resolved by the person importing; `/sync` shows no
conflicts, only rejections (a missing document file). Moving to API access needs a cut-over step for
`credora-` ids: clear them, or replace them with the ids AlayaCare assigned on import, or the HTTP
adapter rejects them and linking refuses with `ALREADY_LINKED`. OPEN-QUESTIONS 250.

## ADR-154 — The export is a per-agency folder of CSVs and document copies under `STORAGE_ROOT/_alayacare-export/`, rendered from one JSON state file, selected deployment-wide by `ALAYACARE_ADAPTER=export`  (2026-09-25, T-114)

**Decision.** `<agencyId>/` holds `employees.csv`, `credentials.csv`, `documents.csv`,
`custom-fields.csv` (RFC 4180, `\r\n`, no BOM), `documents/<objectId>.<ext>` copies read through the
storage port, and `export-state.json`, the source of truth the CSVs are re-rendered from on every
write. Columns reuse `http.ts`'s wire names; custom-field keys are columns in first-seen order.
Documents are addressed by the storage key's object id, so no caller string becomes a path segment.
Every file is written to `<name>.tmp` and renamed into place. A cell starting with `=`, `@`, TAB or
CR, or with `+`/`-` followed by anything outside `0-9 +-().`, gets a `'` prefix. Selection is the
`export` entry of the existing `alayacare` registry slot.

**Because.** INTEGRATIONS.md Rule 3 (env selection only). The background-check mock's
`_mock-background-check` precedent. The T-110 handoff: "custom-field keys as the export's column
names". Caregiver-typed values opened in a spreadsheet are a formula-injection vector.

**Rejected.** A new `STORAGE_KINDS` member or `csv` extension (changes a convention nine tasks share;
export files are not per-caregiver). A database table plus a download page (a new subsystem, with no
PRD line beyond "structured export"). Per-agency selection (needs a schema column and revisits Rule
3). Parsing our own CSVs back (a CSV parser for no gain). An `ALAYACARE_EXPORT_DIR` env var.

**Consequence.** A deployment either syncs every agency by API or exports every agency. One writer is
assumed: each write is a read-modify-write of `export-state.json`, safe only because one worker drains
jobs one at a time (ADR-089). The files are plaintext at rest until removed by hand. OPEN-QUESTIONS 251.

## ADR-158 — Success metrics are computed on read; unmeasurable metrics are shown as not measured  (2026-09-25, T-141)

**Decision.** The report computes five PRD metrics on each request over the 90 days ending now from
`PipelineEvent`, `Caregiver`, `AuditEntry`, `AutoAcceptDecision`, `AlayaCareSync` and `JobAttempt`,
with the definitions in `src/domain/reports/success-metrics.ts`; staff time and sampled-invalid
records are shown as not measured. Agency admin only (`successMetrics.view`); no audit entry
(aggregates, no caregiver record).

**Because.** Every measurable metric is derivable from rows already written, so an instrumentation
table would be a second copy that can drift; the two gaps are product decisions already open
(OPEN-QUESTIONS 11, 176).

**Rejected.** A metrics snapshot table (drift, backfill). Instrumenting staff time or sampling
verdicts here (overrides open questions). Showing zero for an unmeasured metric (invented data).

**Consequence.** Changing a definition changes past windows too — there are no frozen snapshots.
OPEN-QUESTIONS 256, 257, 258.

## ADR-159 — An AlayaCare sync "without manual fixes" is a SYNCED sync whose job ran once  (2026-09-25, T-141)

**Decision.** Read from `JobAttempt`: a finished sync counts as without a manual fix only if it is
SYNCED and its job has exactly one `attempt = 1` row. A sync whose job has no attempt row is not
counted as clean.

**Because.** A stopped sync is fixed only by `requeueJob`, which reuses the job and the sync row, and
`finishAlayaCareSync` overwrites the stopped status; a no-choice retry is unaudited; `requeueJob`
resetting `attempts` leaves a second `attempt = 1`.

**Rejected.** A counter column on `AlayaCareSync` (new storage for a derivable fact).
`keepOursFields`/`keepTheirsFields` non-empty (misses retries without choices and duplicate links).

**Consequence.** Any future `Job` pruning must retain `sync.alayacare` attempts, or this metric
under-reports clean syncs.

## ADR-148 — The admin UI writes only agency-layer templates, through four distinct actions guarded against ambiguity and relaxation  (2026-09-25, T-034)

**Decision.** ADD / OVERRIDE / EDIT / RETIRE, each a separate request kind, always for the
principal's agency. An override copies every axis its base sets plus `agencyId`, and may narrow
further only on axes the base leaves empty. A publish or retire that introduces a resolution
ambiguity in any context is refused (`introducedAmbiguities` reruns the resolver over every context
that can matter for the key; an ambiguity already present does not block). An agency row may not
turn off `manualOnly` or `blocksClearance` on a platform rule it overrides, on OVERRIDE or EDIT.

**Because.** Precedence is axis-set inclusion (T-030, T-031 § Risks 2, ADR-137), so an override that
did not copy its base's axes would be an ambiguity, not an override. ADR-014: platform writes come
only from the seeder. SECURITY: `manualOnly` is the single mechanism that keeps legally
person-assigned steps away from automation.

**Rejected.** Letting the key decide between add and override (a typed key silently replaces a
state rule). UI edits of platform rules (one tenant's session would change every tenant's rules).
A pairwise incomparability check (it refuses cases a third template resolves). Discovering
ambiguity only at send time (the ADR-138 / OPEN-QUESTIONS 226 refusal would reach a caregiver in
flight).

**Consequence.** `src/domain/requirements/template-admin.ts` owns these rules. OPEN-QUESTIONS 244
and 245 name the two product defaults.

## ADR-149 — Agency templates retire from the UI; platform templates retire when the state's library seed no longer contains them; the manual-only CHECK rejects a blank reason  (2026-09-25, T-034)

**Decision.** `retireRequirementTemplate` and `retirePlatformTemplatesNotIn` in the writer; the
latter runs at the end of `seedNyPlatformRequirementTemplates`, scoped to platform rows with
`state = 'NY'`. `RequirementTemplate_manual_only_reason` now requires a non-null, non-blank reason.
`AuditEntityType` gains `REQUIREMENT_TEMPLATE`. Rows are retired, never deleted.

**Because.** T-033 § Risks 10: a rule removed from the library stayed live. ADR-014. T-030 REVIEW: a
whitespace reason passed the CHECK.

**Rejected.** A UI withdraw of platform rules (ADR-148). Reconciling agency defaults (it would
retire rules an admin created or edited). Tightening only in zod (a raw writer still bypasses it).
An ambiguity check in the seeder (a seed-introduced ambiguity fails closed and the preview shows it).

**Consequence.** The library file is the full list of live NY platform rules; deleting an entry
withdraws that rule on the next seed.

## ADR-151 — Training imports: read in place, stored once, mapped by a staff-set platform id  (2026-09-25, T-090)

**Decision.** The scheduled export is read through the port where it lives (`sourceRef` stays a
string, not a `storageKey`). Completions are unique on (agency, platform caregiver id, course,
date); the first import wins. `Caregiver.trainingPlatformId` is the mapping, set by staff from the
unmatched list; unmatched completions are held with no caregiver and attached on link. A missing
export is transient (throw → retry → dead-letter; the next daily occurrence retries). Rejected
rows are stored per import and shown. The job calls repositories under `runAsSystem`
(OPEN-QUESTIONS 21).

**Because.** T-057 § Risks 3-4, T-050 § Risks 4, PRD § 6 bullet 1: silently dropping rows is the bug.

**Rejected.** Landing the file in storage (an unread second copy of caregiver ids). Matching by
name/DOB (the export has neither; identity matching is document-scoped). Dropping unmatched rows
(hours lost until the next export). Catching ENOENT as permanent (couples the handler to the
mock's fs error).

**Consequence.** A changed-minutes re-export is not reported (OPEN-QUESTIONS 249). Deleting a
caregiver deletes their completions, and the next import holds them again as unmatched.

## ADR-152 — Training requirements are satisfied by category, against the pinned minimum, for the calendar year  (2026-09-25, T-090)

**Decision.** Courses are classified by `courseCode` prefix in `classifyCourse`. A TRAINING
instance is fed by the category whose evidence key its template accepts. No minimum → one
completion satisfies; a minimum → this UTC calendar year's minutes must reach it. Met →
`TRAINING_RECORD` evidence per counted completion, `SATISFIED`, `applyVerificationCompleted` in the
same transaction. A shortfall is computed at read time and is never a status.

**Because.** PRD § 6 bullet 2, ADR-055, ADR-113, DOMAIN "Renewal rule … Recorded, not acted on".

**Rejected.** An agency course-category table and screen (no PO input on the platform's labels —
OPEN-QUESTIONS 60). A shortfall status (it would make a non-blocking rule look exceptional in the
queue). Rolling 12 months (OPEN-QUESTIONS 248).

**Consequence.** An in-service instance satisfied last year stays `SATISFIED` into the next year
while /training flags the new year's shortfall.

## ADR-155 — Retention runs as one daily `retention.sweep` job per agency, scheduled at worker boot, under `runAsSystem` with unguarded repositories  (2026-09-25, T-130)

**Decision.** `scripts/worker.ts` calls `ensureRetentionSchedules` once at boot, which creates one
`retention.sweep` `JobSchedule` (86 400 s) per agency id from `listAgencyIds`, a declared unscoped
read returning ids only. The job runs under `runAsSystem`, calls unguarded repositories and the
restricted accessors directly, and audits as the ambient SYSTEM actor. The periods are the
`RETENTION_PERIODS` table in `src/domain/retention/rules.ts`.

**Because.** A job has no principal (OPEN-QUESTIONS 21) and T-111 set the pattern. A `Job` needs
an `agencyId`, so the schedule is per agency, and worker boot is the one moment that sees every
agency.

**Rejected.** `system?: true` in `policy.ts` (a judgement call the notes forbid). Scheduling from
the seed (never runs in production). A table of periods in Postgres (no one asked for per-tenant
periods).

**Consequence.** An agency created after boot gets its schedule on the next worker start.

## ADR-156 — Audit entries are deleted after 7 years, never while their caregiver is on file, inside one transaction that disables and re-enables `audit_entry_append_only`; two new entity types `INBOUND_WEBHOOK` and `AUDIT_LOG`  (2026-09-25, T-130)

**Decision.** `deleteAuditEntriesBefore` disables the trigger, deletes this agency's entries older
than the cutoff whose `entityId` is not a caregiver on file, and re-enables it, all in the caller's
transaction; the sweep then writes one `DELETE AUDIT_LOG` entry carrying the count.

**Because.** The PRD gives no period (OPEN-QUESTIONS 252). T-013 § Design 5's floor (the I-9
audit-trail clause) is met by the `NOT EXISTS`. DDL is transactional and `ALTER TABLE` takes
`ACCESS EXCLUSIVE`, so there is no window in which another writer can bypass the trigger.

**Rejected.** A separate role that bypasses the trigger (the app role owns the table). Deleting
entries about caregivers still on file.

**Consequence.** The audit pass briefly blocks every audited write platform-wide; it runs last and
is one statement. A large backlog should be batched by `at`, never by removing the lock.

## ADR-157 — Deletion order: a caregiver's rows first, then bytes and schedules; unsigned PDFs bytes first; EEOC rows are deleted, not pseudonymised  (2026-09-25, T-130)

**Decision.** A never-started applicant's core rows, both restricted stores and its webhook rows go
in one audited transaction (`deleteMedicalFile`/`deleteEeocRecord` join it); storage keys read from
its rows are deleted and its `reference.chase:` / `backgroundCheck.poll:` schedules stopped after
commit. An unsigned generated PDF's bytes are deleted first, then `unsignedPdfDeletedAt` is stamped
with its audit entry.

**Because.** The caregiver delete is guarded on stage `INVITED` and may refuse inside the
transaction; deleting bytes first would lose a live applicant's files. A terminal envelope or
withdrawn caregiver has no such race. EEOC: DATA-MODEL invariant 3 says delete, and a
never-started applicant never reached the voluntary form, so no historical aggregate changes in V1.

**Rejected.** Bytes before rows for caregivers (the race above). Pseudonymising EEOC rows.

**Consequence.** A crash after commit leaves orphaned bytes; nothing sweeps them because the
storage port has no `list`.

## ADR-160 — The AlayaCare mock follows the published employee API, for only the endpoints the adapter calls; retry safety moves into the adapter  (2026-09-27)

**Decision.** `mock-servers/alayacare` now serves AlayaCare's published OpenAPI shapes under
`/ext/api/v2/employees`: employees (list with `filter`, create, read and update by id or external
id), `/profile/employee`, `/skills`, `/employee_skills`, the per-employee skills view, and
attachment files. The tenant is the Basic-auth public key. Contacts, notes, unavailabilities and the
lookup lists are not mocked because the port does not use them. `AlayaCarePort` is unchanged. The
adapter maps custom fields to `demographics` tags, credentials to employee skills (the mapping's
credential code is the skill id), documents to attachments under `Credora/`. It sends the caregiver
id as `external_id`.

**Because.** AlayaCare's reference is now public (developer.alayacare.com), so ADR-048's invented
wire is no longer needed. Mocking only what Credora calls keeps the mock small. The docs' gaps
(PUT merge semantics, `filter` matching, the private key) are marked `Assumed, not documented` in
the mock.

**Rejected.** Mocking all 63 employee operations (unused surface). Keeping the invented routes
beside the real ones (a mock that is only partly faithful).

**Consequence.** The API has no idempotency header and no duplicate or DOB check. The adapter now
guarantees retry safety through the `external_id` 409, an existing identical skill and an identical
file at the same path. It keeps the name/DOB pre-check that the old mock did server-side. The port's
`idempotencyKey` is validated but not sent. A live adapter still needs per-agency hosts and API keys.
ADR-048's rule that each side owns its wire schemas still holds.

## ADR-161 — Credora sends no text messages: email replaces SMS, and the caregiver's email is the sign-in key  (2026-09-27)

**Decision.** Every message goes by email through an email-only messaging port (no `channel`).
Caregivers sign in at `/verify` with an emailed one-time code. Invites, staff-decision notices and
reference requests are emailed; a reference with no email gets the existing no-contact path. Staff
enter the caregiver's email at invite. It is unique per agency among live caregivers, not editable
in intake, and corrected only by staff (`caregiver.correctEmail`). The mobile phone becomes an
ordinary required intake field, still sent to AlayaCare and printed on agency documents. SMS
consent, the email-verification link flow, `ReferenceAttempt.sentChannels` and the
`MessageChannel` enum are removed.

**Because.** The product owner does not want a paid SMS vendor, and AlayaCare requires an email for
every employee anyway (ADR-160), so email is the one channel every caregiver must have. Signing in
with an emailed code proves the address, which makes a separate verification link redundant.

**Rejected.** Keeping SMS behind the mock for later (dead code with its own consent rules).
Keeping phone sign-in with email invites (two identities to keep in step, and sign-in would still
need texts).

**Consequence.** Supersedes ADR-058's lookup key (the unscoped read is now by email; ambiguity
still sends nothing), ADR-060 (no verification link), ADR-074 and ADR-088 (no SMS consent), and
ADR-087's subject (it is now the email that intake cannot edit). ADR-057, ADR-059 and ADR-061 hold
unchanged for the emailed code. OPEN-QUESTIONS 83, 113, 144, 146, 152, 229 and 260 are closed by
this. The migration deletes dev-only rows that cannot survive: mock SMS sends, verification links,
and notices cancelled for SMS reasons (mapped to CANCELLED).
