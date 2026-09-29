---
task: T-143
slug: test-suite-diet
title: Fast, lean test suite: parallel db tests and a one-time prune
prd: "Technical architecture"
reads:
  # THE COMPLETE required reading. Part (b) additionally requires reading every test file this
  # plan lists as a prune candidate (§ Prune candidates) and, for each R/D candidate, the unit
  # test file named beside it — that is the one place this task reads beyond this list, and it
  # is bounded by the lists below. Do not grep src/ for more candidates.
  - docs/context/CONVENTIONS.md                 # § Tests (the six bullets; two of them change here)
  - docs/tasks/_TEMPLATE.md                     # § Tests to write — the prune rules, quoted in Design § B
  - docs/context/ORCHESTRATION.md               # § "Concurrent agents get their own test database" (rewritten here) and § "Migrations take a global advisory lock"
  - vitest.config.mts                           # the `db` project: fileParallelism:false, env, timeouts
  - scripts/db-test-setup.mjs                   # migrates CREDORA_TEST_DB — becomes the clone TEMPLATE, unchanged
  - src/db/maintenance.ts                       # truncateAllTables (replaced), catalogueTables, tableRowCounts, appliedMigrationNames
  - src/db/testing.ts                           # probeDatabase, describeDatabase (beforeEach reset)
  - src/db/maintenance.db.test.ts               # the reset's own tests
  - src/db/maintenance.test.ts                  # production refusal
  - src/db/audit.db.test.ts                     # lines 255-280: "truncateAllTables still clears AuditEntry"
  - src/integrations/adapters/messaging/mock.db.test.ts   # line ~70: calls truncateAllTables mid-test
  - src/server/dev/database.ts                  # resetDevDatabase calls truncateAllTables
  - prisma/migrations/20260923070035_audit_entry/migration.sql   # lines 46-57: the append-only row trigger and why TRUNCATE bypasses it
  - package.json                                # devDependencies (pg and @types/pg are added)
writes:
  - vitest.config.mts
  - package.json
  - package-lock.json
  - src/db/maintenance.ts
  - src/db/testing.ts
  - src/db/testing-global-setup.ts              # new
  - src/db/testing-worker-setup.ts              # new
  - src/server/dev/database.ts                  # rename of the reset only
  - scripts/db-constraint-mutation.mjs          # new, kept
  - docs/context/CONVENTIONS.md
  - docs/context/ORCHESTRATION.md
  - docs/tasks/T-143-test-suite-diet/LEDGER.md          # new: one row per removed/moved test
  - docs/tasks/T-143-test-suite-diet/tests-before.txt   # new: `vitest list` of the untouched tree
  - docs/tasks/T-143-test-suite-diet/tests-after.txt    # new
  - docs/tasks/T-143-test-suite-diet/ledger-check.mjs   # new, one-off
  - docs/tasks/T-143-test-suite-diet/mutation-before.json   # new: killed set on the untouched tree
  - docs/tasks/T-143-test-suite-diet/mutation-after.json    # new
  - src/**/*.test.ts                            # prune: delete tests, trim copy asserts, receive moved pure tests
  - src/**/*.test.tsx
  - src/**/*.db.test.ts
depends_on: [T-023, T-034, T-036, T-082b, T-090, T-113, T-114, T-130, T-141]
---

# T-143 — Fast, lean test suite: parallel db tests and a one-time prune

## What this task must produce

The database test suite runs in about two minutes instead of twenty-five, on a machine and a
Postgres container shared with other agents, with `CREDORA_TEST_DB` meaning what it means
today. And the whole suite is pruned once to the rules every plan now states: no framework or
schema-shape tests, no exact-copy asserts, no database test re-proving a rule a unit test
already proves, no pure test living in a `*.db.test.ts` — with an executable proof that no
behaviour coverage was lost: every removed test is mapped to a surviving test of the same rule,
and every database constraint and trigger that reddened a test before still reddens one after.

## PRD requirements covered

`docs/PRD.md § Technical architecture` has no bullet about testing; this is build
infrastructure. What it serves is the rule set in `docs/tasks/_TEMPLATE.md § Tests to write`:

- > "Test a rule once, at the lowest layer that can prove it: pure rules in unit tests; `*.db.test.ts` only for what needs a database — queries, constraints, triggers, agency scoping. Do not test the framework, the schema's shape, or exact copy strings, and do not re-assert through the database a rule already proven as a pure function."

and the task's binding note in `dag.json`: "No behaviour coverage may be lost: every PRD bullet
covered before is still covered after, and dropping a DB constraint or trigger must still redden
a test. Report before and after: file counts, test counts, wall-clock for each suite."

## Baseline (measured by the planner at a783802, 2026-09-25)

| Suite | Files | Tests | Test LOC | Wall-clock |
| --- | --- | --- | --- | --- |
| unit (`--project unit`, incl. 1 mock-servers file) | 173 | 3,414 (4 skipped) | 19,486 | 22.0 s (vitest Duration) |
| ui (`--project ui`) | 32 | 139 | 1,779 | 51.7 s alone |
| db (`--project db`, own DB) | 129 | 1,171 | 27,114 | **1,508.6 s = 25 min 11 s** (+7 s `db:test:setup`) |
| total | 334 | 4,724 | 48,379 | — |

Source (non-test, non-generated `.ts/.tsx` under `src/` and `mock-servers/`): 35,953 LOC.
All tests passed at baseline. (The dag note's 303/186/117 predates T-130 and friends.)

**Where db time goes.** Summed per-test time was 1,340 s; median test 1,011 ms, p90 1,533 ms.
`TRUNCATE` of the 55 core/medical/eeoc tables measured **794 ms per call** on the shared
container (catalogue query 2.6 ms). One per test × 1,171 tests ≈ 930 s — **~69 % of all db
test time is the reset**, ~135 s is module import, the rest is test bodies (the slowest are
scrypt/seed-heavy: `server/dev/demo-seed.db` 4.1 s/test, `db/seeds/alvita.db` 4.3 s/test,
`server/auth/session.db` 1.7 s/test).

**Spikes (reverted, not committed).**
1. Ordered `DELETE` reset (one `DO` block: `DELETE FROM` every table children-first, `TRUNCATE`
   only `core."AuditEntry"` and only when it has rows): **4.4 ms** empty, 6.8 ms populated, vs
   794 ms. On ten heavy files (161 tests, incl. `jobs.db` SKIP LOCKED, `audit.db`,
   `retention.db`, `maintenance.db`, `testing.db`) file time went **181.8 s → 35.6 s**, all green.
2. Plus per-worker databases cloned from the migrated base (`CREATE DATABASE … TEMPLATE`,
   **~100 ms** per clone), `maxWorkers: 4`: full db suite **25 min 11 s → 2 min 07 s**
   (Duration 119 s), **1,171/1,171 green**, clones removed afterwards. `npx vitest run` (all
   three projects) 2 min 40 s.
3. Found by the spike: in vitest 4.1 a project with its own `maxWorkers` needs its own
   `sequence.groupOrder`, or the combined run aborts with *"Projects "db" and "ui" have different
   'maxWorkers' but same 'sequence.groupOrder'"*. `VITEST_POOL_ID` is allocated from the
   **global** pool (1..global maxWorkers), not 1..4, so clones are created lazily per pool id,
   never pre-created for 1..4.
4. One ui test failed once in the combined run under load and passed in two reruns of
   unit+ui: `src/app/_components/sensitive.test.tsx › shows the formatted value, closes the
   dialog and moves focus once revealed` (`toHaveFocus`). Not caused by this task; see Risks.

## Design

### A. Speed (ADR-160, orchestrator writes it)

**Decision.** Two changes, both measured above: (1) reset between tests by an ordered `DELETE`
instead of `TRUNCATE`; (2) run db files in parallel, each vitest worker on its own database
cloned from the migrated `CREDORA_TEST_DB`.

**Rejected: per-test transaction rollback.** Once the reset costs ~5 ms there is nothing left
for rollback to save, and it would cost a lot: the global `prisma` client would have to be
swapped per test for a transaction-bound proxy with savepoints under `src/db/audit.ts`'s own
`$transaction`, and three tests need several committed connections by design and cannot run
inside one transaction — `db/repositories/jobs.db` (five concurrent `FOR UPDATE SKIP LOCKED`
claimers), `db/repositories/link-tokens.db` (two concurrent consumes),
`integrations/queue/schedule.db` (two concurrent ticks) — plus `retention.ts`'s
`ALTER TABLE … DISABLE TRIGGER`. **Rejected: keep TRUNCATE, parallelise only** — 4× on a cost
that the DELETE removes 180× is the wrong lever, and four concurrent 55-table TRUNCATEs contend
on the shared container.

**1. Reset.** In `src/db/maintenance.ts` replace `truncateAllTables` with
`emptyAllTables(): Promise<void>` (rename: it no longer truncates; update the six callers —
`testing.ts`, `maintenance.db.test.ts`, `maintenance.test.ts`, `audit.db.test.ts`,
`integrations/adapters/messaging/mock.db.test.ts`, `server/dev/database.ts`). Same production
refusal, same message with the new name. It builds, once per process (cache the promise), one
statement from the catalogue: tables from `catalogueTables()`, FK edges from `pg_constraint`
(`contype = 'f'`) restricted to the three schemas, ordered children-first; each table becomes
`DELETE FROM <ident>;` except `core."AuditEntry"`, which becomes
`IF EXISTS (SELECT 1 FROM core."AuditEntry") THEN TRUNCATE core."AuditEntry"; END IF;` —
`DELETE` would fire the append-only row trigger, and TRUNCATE bypassing it is the existing,
documented design (migration 20260923070035, ADR-010). The whole thing is one
`DO $$ BEGIN … END $$` sent with `$executeRawUnsafe` (one round trip). Identifiers come only
from `quote_ident` over the catalogue, as today. If the FK graph has a cycle (none today;
no self-references), throw an error naming the tables — never loop. No sequences exist in the
three schemas (checked: 0 serial/identity columns), so `RESTART IDENTITY` has no replacement.
`public._prisma_migrations` stays untouched.

**2. Per-worker clones.**
- `vitest.config.mts` `db` project: remove `fileParallelism: false` and its comment; add
  `maxWorkers: 4`, `sequence: { groupOrder: 1 }`, `globalSetup: ['./src/db/testing-global-setup.ts']`,
  `setupFiles: ['./src/db/testing-worker-setup.ts']`. Keep `env` (`DATABASE_URL` still names the
  base), both 60 s timeouts and their comment. Rewrite the top comment's last lines: the base
  name is `CREDORA_TEST_DB`; tests run on its clones.
- Clone name: `<base>__w<VITEST_POOL_ID>` (double underscore, so a pattern can never match
  another agent's base such as `credora_test_w1`).
- `src/db/testing-worker-setup.ts` (runs in each worker before any test module, so before
  `env.ts` parses): derive base from `process.env.DATABASE_URL`; connect with `pg` to the
  `postgres` maintenance database on the same host/port/credentials; if the clone does not exist,
  `CREATE DATABASE "<clone>" TEMPLATE "<base>"` (treat `42P04 duplicate_database` as success);
  then set `process.env.DATABASE_URL` to the clone. If the server is unreachable (same errno list
  as `testing.ts`'s `UNREACHABLE`), do nothing and leave the URL alone, so `probeDatabase` still
  reports "unreachable" and the suites skip — `npm run test` must stay green with Docker down.
  Any other error propagates.
- `src/db/testing-global-setup.ts` (main process, once per run): drop every database matching
  `^<base>__w[0-9]+$` (`DROP DATABASE … WITH (FORCE)`) before the run, and return a teardown
  that does the same after. Before: so a clone made from an older migration never survives
  into a run (a crashed run's clones are cleaned by the next). After: so the container does
  not accumulate databases. Unreachable server: return without error (same skip rule).
- Both files refuse, with a clear error, a base named `credora` (the dev database) — cloning it
  would fail anyway while the dev server is connected, and tests must never run on dev data.
- `CREATE DATABASE … TEMPLATE` needs no session connected to the base. Nothing connects to it
  during a run any more (`probeDatabase` runs on the clone), and `db:test:setup` finishes before
  vitest starts. Two concurrent runs with the **same** `CREDORA_TEST_DB` break each other — as
  they always did; different values are fully isolated, clones included.
- `pg@8.23.0` and `@types/pg@8.23.1` become exact-pinned devDependencies — the versions already
  in `package-lock.json` under `@prisma/adapter-pg`, so no new package is downloaded. Raw `pg`
  is needed because `CREATE/DROP DATABASE` must run outside any Prisma client bound to a test
  database, and spawning the Prisma CLI per file costs seconds.
- `src/db/testing.ts`: `describeDatabase` calls `emptyAllTables`; doc comments say "empties"
  rather than "truncates". `testDatabaseName()` now reports the clone name — make the
  "not migrated" message name the base (strip `__w<n>`) since that is what the user must set up.

**Connections.** 4 workers × one pg pool each (lazy; tests are sequential within a file) plus
a transient admin connection per file. Three concurrent full runs (ORCHESTRATION's cap) stay
well under `max_connections = 100` in practice; do not add pool configuration unless a run
actually hits `53300 too_many_connections`.

### B. One-time prune

**Rules applied** (template § Tests to write). A test is removed or trimmed only when it is one of:

- **F** framework / schema-shape: asserts Prisma, zod, React, Next or a library does its job, a
  constant equals itself, a type narrows, a column exists — with no rule of ours behind it.
- **C** exact copy: pins a whole user-facing sentence. Replace the assertion with the key fact
  (a name, a date, "blocks clearance", "3 days") when the test otherwise proves a rule; delete
  the test when copy was all it proved. Developer-facing error texts and codes are not copy.
- **R** db test re-proving a unit-tested rule: keep **one** db case per use case that proves
  wiring (the use case applies the rule and persists the outcome / writes nothing); remove the
  other rows. RBAC: keep one denied role per use case (proves the guard is wired and nothing is
  written); the role matrix lives in `src/server/auth/policy.test.ts`. "Malformed payload"
  tests in job files are R to `src/integrations/queue/handler.test.ts`.
- **D** unit duplicate: the same rule already asserted by another unit test.
- **P** pure test in a `*.db.test.ts`: move it to the sibling `*.test.ts` (create it if absent)
  unchanged except imports; where a pure rule exists only inline in a use case (the
  `void-envelope` NOT_VOIDABLE statuses), do **not** extract code in this task — keep one
  db case per distinct outcome and log it in LEDGER as "kept: no pure function".

**Keep, even though they read schema text** (they are invariants, not shape, and nothing else
reddens when they break): domain-enum ↔ Prisma-enum mirrors; no `*Enc` column in any key or
index; exactly the five encrypted columns and their tier tag; composite tenancy FK on every
caregiver satellite; restricted models have no relation and live only in `medical`/`eeoc`;
AuditEntry column list = SECURITY.md; ADR-009 (no `previewFeatures`/datasource url); sealed
selects hold no `*Enc`; import allowlists (`sensitive-field.test.ts`, `accessor-surface.test.ts`).
So `src/db/schema-core.test.ts` is **trimmed, not deleted** — this deliberately narrows the dag
note's example; state it in REVIEW. Consolidate the five one-assertion enum-mirror files
(`repositories/{reference-checks,envelopes,invites,link-tokens,staff-decisions}.test.ts`) into
`schema-core.test.ts`'s mirror table.

Also keep the adapter-default rows of `src/lib/env.test.ts` ("defaults %s to %s": every port is
the mock unless configured — a safety rule, not zod mechanics).

**Before touching any test** (the proof depends on it):
1. `npx vitest list --json=<scratch>/before.json` over all three projects on the untouched tree
   (the db project needs a migrated `CREDORA_TEST_DB` to collect); write
   `tests-before.txt`: one line per test, `<path> > <describe…> > <name>`, sorted.
2. Run `scripts/db-constraint-mutation.mjs --out docs/tasks/T-143-test-suite-diet/mutation-before.json`
   on the untouched tree (after Part A lands is fine — Part A changes no test).

**LEDGER.md.** One table row per removed, trimmed or moved test:
`| before id | category F/C/R/D/P | action deleted/trimmed/moved | covered by (after id) or — |`.
"Covered by" is mandatory for R, D and P (P: the moved test's new id); it is `—` only for F
and for a C test that proved nothing but copy. Trimmed tests keep their id and are listed with
the assertion removed.

**`ledger-check.mjs`** (task folder, one-off, plain Node, no deps): reads `tests-before.txt`,
`tests-after.txt` and `LEDGER.md`; fails listing (a) every id in before and not in after that
has no ledger row, (b) every "covered by" id not present in after, (c) every ledger row whose
before id is still present in after with action `deleted`/`moved`. Exit 0 prints counts per
category. This is the PRD-bullet proof: a test only leaves when it covered no rule (F/C) or when
a named survivor proves the same rule, so every bullet a test covered before is still covered
by a test after. (A per-bullet inventory of the 283 quoted bullets in `docs/tasks/*/PLAN.md`
was considered and rejected: plans name files, not test ids, so it could not be checked
mechanically, and it would prove less than the ledger.)

**`scripts/db-constraint-mutation.mjs`** (kept: every future task that adds a CHECK, unique
index, cascade or trigger can use it to prove a test covers it). Plain Node + `pg`:
- Inventory from the migrated base's catalogue (not by parsing migrations, which drop and
  re-add constraints): every CHECK (`contype='c'`), every FK (`contype='f'`, all delete actions),
  every unique non-primary index (`pg_index.indisunique and not indisprimary`; drop via
  `DROP INDEX`, or `DROP CONSTRAINT` when the index backs a constraint), every non-internal
  trigger — in `core`, `medical`, `eeoc`. At baseline: 17 CHECK, 56 FK (37 CASCADE, 14
  RESTRICT, 5 NO ACTION), 53 unique indexes, 1 trigger = **127 objects**.
- Per object: `CREATE DATABASE <base>_mut TEMPLATE <base>`, drop the object in it, run
  `npx vitest run --project db <files> --reporter=json` with `CREDORA_TEST_DB=<base>_mut` (so
  its worker clones inherit the mutation), then drop `<base>_mut` (its clones are dropped by the
  global teardown). **Killed** = the JSON report has ≥ 1 failed test; an exit with no failed
  test (collection/infra error) is reported as `error`, never as killed.
- Files per object: `*.db.test.ts` whose text contains the constraint/index/trigger name, the
  table name quoted (`"Evidence"`), or the Prisma delegate (`.evidence.` / `.evidence(` — model
  name with a lower-case first letter), plus `--also <json>`: the files that killed this object
  in a previous run. If an object survives on that set, rerun it once on the **whole** db suite
  before recording `survived` — so a thin mapping never produces a false loss.
- Output JSON: `{ object, kind, table, files, result: killed|survived|error, killedBy[] }[]`.
  `--only <json>` restricts to objects killed in that file.
- Refuses a base named `credora`. Runs objects sequentially (each run already uses 4 workers).
  Estimated 40–60 min per full pass; run it in the foreground with a long timeout, or in
  batches with `--only`.

**Constraint rule.** `mutation-after.json` (run with `--only mutation-before.json --also
mutation-before.json`) must show `killed` for every object killed in `mutation-before.json`.
Gaps that already exist at baseline are not losses; fill only the CHECK and trigger gaps (the
db categoriser found two CHECKs no test touches: `Evidence_uploaded_document_source` and
`TrainingCompletion_minutes_nonnegative` — add one insert-and-expect-rejection case for each in
`src/db/repositories/uploaded-documents.db.test.ts` and `training.db.test.ts`), and list the
remaining FK/unique survivors in REVIEW.

### Prune candidates (from the planner's baseline scan — read each file before acting)

Counts are approximate ("each" blocks counted once); the implementor confirms every one against
its unit-test counterpart before removing it. Totals found: db ~190 removable cases + ~25
copy-trims; unit/ui ~60 F, ~31 C, ~49 D (plus the two 90-row tables in `manual-only.test.ts`).

**F — framework / schema shape (src/db):**
- `src/db/schema-core.test.ts` (43 tests): delete the 12 shape tests — Caregiver `@@unique([agencyId,id])` (implied by composite-FK test); Caregiver has no restricted relation (3rd copy); every `*Enc` optional Bytes; every `@encrypted` named `*Enc`; AuditEntry/PipelineEvent no `updatedAt`; "only actorId/fieldName/reason/ip optional"; AuditActorRole = UserRole+SYSTEM; AcceptedEvidence cascade / template restricts agency; `@@unique([scopeKey,key,version])`; RequirementInstance→template Restrict; Evidence tenancy/cascade/no updatedAt. Keep the rest (listed under Keep above).
- `src/db/schema-boundary.test.ts`: "MedicalFile in medical, EeocRecord in eeoc" and "restricted models: scalar caregiverId, no @relation" (duplicates of schema-restricted).
- `src/db/schema-restricted.test.ts`: "MedicalFile keeps its five columns" (medical.db proves it).
- `src/db/factories.db.test.ts`: 7 fixture self-tests (defaults land, override replaces one field, credential expired 2020, default expiry sentinel, no encrypted column written, sealed SSN via override, createUser distinct email). Keep "writes caregiver + 4 satellites" and "two caregivers with identical defaults coexist".
- `src/db/mapping/mapping.db.test.ts`: "endedOn null stays null", "envelope and last4 survive Postgres", "sealed select leaves envelope in DB"; keep one of the two `@db.Date` tests (the eight-column one) and the scoped-key test.
- `src/db/crypto.db.test.ts`: "null round-trips as null", "encryptFieldWithLast4 pair lands in both columns"; keep the bytea round trip.
- `src/db/requirement-template.db.test.ts`: "platform STATE row and agency AGENCY row both insert", "publishing a version retires the previous one" (raw SQL, no code of ours), "stored scopeKey is scopeKeyOf the four axes".
- `src/db/home-care-profile-vaccination.db.test.ts`: "saving Hep B stores the choice".
- `src/server/intake/home-care-profile.db.test.ts`: "stores certifications as the CertificationLevel column".

**F — unit/ui:**
- `src/domain/requirements/manual-only.test.ts`: "cartesian is 90" and the two 90-row `it.each`; the exhaustive-switch / `@ts-expect-error` tests.
- `src/lib/env.test.ts`: zod-default/enum/url tests (NODE_ENV default, STORAGE_ROOT default, ALAYACARE_BASE_URL default, ANTHROPIC_API_KEY undefined, accepts mock server URL, APP_URL default, unrecognised NODE_ENV, non-URL DATABASE_URL). Keep adapter defaults and the encryption-key tests.
- `src/integrations/registry.test.ts`: "is importable", "resolves the default adapter for %s" (⊂ assertEveryPortResolves), the two `typeof function` getPort tests, "judge is the mock by default" (D).
- `src/integrations/ports/schemas.test.ts`: "%s accepts a valid example" / "%s rejects an invalid example"; keep judgeInput strict/no-identifier. `src/integrations/ports/esign.test.ts`: "accepts a null signedPdfKey".
- Constant-equals-itself pins: `src/domain/auth/role.test.ts` (USER_ROLES list; ROLE_ACCESS has every data class), `auth/one-time-code.test.ts` (defaults), `pipeline/invite.test.ts` (options vocabulary), `pipeline/board.test.ts` (BOARD_STAGES literal — keep the subsequence line), `eeoc/self-identification.test.ts` (race list), `requirements/instance-status.test.ts` (seven statuses), `requirements/template.test.ts` (membership/order of 4 lists), `requirements/background-check.test.ts` (status list), `masking/sensitive-field.test.ts` (four fields), `medical/screening.test.ts` (one entry per section), `documents/agency-templates.test.ts` (nine templates), `documents/official-forms.test.ts` (versions pinned), `forms/definition.test.ts` (FIELD_KINDS no duplicates), `forms/sections/home-care-profile.test.ts` ("required by…", "is plain JSON"), `src/server/webhooks/jobs.test.ts` (payload schema shape), `src/integrations/adapters/judge/mock.test.ts` (modelVersion 'mock').
- `src/ui/button.test.tsx` (className merge), `ui/data-table.test.tsx` (React keys), `ui/masked-value.test.tsx` (renders string handed), `ui/progress-bar.test.tsx` (empty track at max 0).
- Echo tests ("shows the refusal" where the test mocks the message it then finds): `admin/users/staff-user-controls`, `checks/adjudicate-background-check`, `checks/decide-reference-check`, `checks/order-background-check`, `sync/[caregiverId]/link-employee`, `clearance/record-health-screening-result`, `admin/users/invite-staff-form` (refusal half) — all under `src/app/(staff)/`. Keep **one** of these as the form-error wiring test (`checks/decide-reference-check.test.tsx`).

**C — exact copy** (trim to the key fact unless noted):
- db: `src/db/repositories/caregiver-record.db.test.ts` ('This is required.' ×2, 'You have already listed this.', PRESENCE_HINT sentence); `db/repositories/sealed-form-values.db.test.ts` (audit reason literal); `db/repositories/verification.db.test.ts` (full "Caregiver X does not exist…" — use a regex fragment); `server/review/caregiver-notice-job.db.test.ts` ("a re-upload request uses its own wording" — delete); `server/verification/reference-jobs.db.test.ts` ("the SMS names the agency and the caregiver" — keep names only; subject/"expires in 14 days" → key facts); `server/users/staff-invite-email-job.db`, `server/caregivers/email-verification.db`, `server/caregivers/invite-sms-job.db` (subjects/bodies → key facts); `server/intake/restricted-sections.db`, `server/intake/flow.db` ("This is required." → the field id/issue code); `server/intake/own-record.db` (labels/"Not answered" → keep masking/audit asserts); `server/forms/agency-documents.db` (document names → keys); `server/sync/alayacare-sync-issues.db`, `server/sync/alayacare-sync-job.db` (reason sentences → `conflictFields`/status codes); `server/verification/background-check-jobs.db` (lastError sentence → fragment).
- unit/ui: `src/app/(caregiver)/documents/_components/capture-form.test.tsx`; `(caregiver)/intake/_components/section-form.test.tsx` (also D to validate.test); `(staff)/admin/mapping/source-options.test.ts` ("labels are plain English"); `(staff)/admin/users/invite-staff-form.test.tsx`; `(staff)/caregivers/[id]/correct-mobile-phone.test.tsx`, `resend-invite.test.tsx`, `void-envelope.test.tsx`; `(staff)/checks/adjudicate-background-check.test.tsx`, `order-background-check.test.tsx`, `record-chrc-step.test.tsx`, `record-manual-check.test.tsx`, `record-reference-response.test.tsx`, `request-reference.test.tsx` (keep "3 days"); `(staff)/clearance/record-health-screening-result.test.tsx`, `sign-off-clearance.test.tsx`; `(staff)/pipeline/actions.test.ts` (also D), `withdraw-caregiver.test.tsx`; `(staff)/sync/[caregiverId]/retry-sync.test.tsx`; `src/app/_components/sensitive.test.tsx` (also D to ui/dialog.test); `src/app/verify/actions.test.ts` (also D); `src/domain/pipeline/withdrawal.test.ts` (BLANK rows: assert the refusal, not the sentence); `domain/forms/validate.test.ts` ('List up to 5 names.'); `domain/documents/agency-templates.test.ts`, `official-forms.test.ts` (SAMPLE notice → prefix regex).

**R — db tests re-proving unit-tested rules** (keep one wiring case; counterpart unit test in brackets):
- src/db: `repositories/document-set.db` 4 selection cases [domain/requirements/resolve.test, scope.test; domain/documents/document-set.test]; `repositories/requirement-templates.db` publish/role scopeKey-layer derivation, "agency override wins", "no accepted evidence refused" [requirements/scope.test, template.test, resolve.test]; `repositories/requirement-instances.db` "agency override wins", ILLEGAL_TRANSITION half, role-derivation half [resolve.test, instance-status.test, role.test]; `repositories/pipeline-transitions.db` each ALREADY_APPLIED/ILLEGAL/TERMINAL → 1 [pipeline/transitions.test]; `repositories/document-review.db` SIGNING/WITHDRAWN not moved [transitions.test]; `repositories/verification.db` 6 statuses → 1 [requirements/blocker.test]; `repositories/official-form-record.db` and `agency-document-context.db` "partial address reads null" [db/mapping/address.test]; `repositories/alayacare-mapping.db` DUPLICATE/UNKNOWN_KEY, restricted source throws [domain/sync/alayacare-mapping.test]; `restricted/eeoc.db` "withholds below five", "no caregiver id" [domain/eeoc/aggregate-report.test]; `repositories/accepted-issuers.db` normalises-equal [documents/accepted-issuer.test]; `repositories/extractions.db` normalisation half, `repositories/credentials.db` completionDate assertion [documents/extraction.test]; `repositories/training.db` below/at minimum [requirements/training-hours.test]; `repositories/check-results.db` "unlisted key NOT_ACCEPTED" and `uploaded-documents.db` "links under accepted key" (db dups of requirement-instances.db); `Evidence_exactly_one_source` asserted in 4 files → keep it in `requirement-instances.db` only; `requirement-template-minimums.db` whitespace reason (dup of requirement-template.db); `crypto.db` "stored bytes don't contain plaintext" [db/crypto.test].
- src/server & integrations (top files first): `caregivers/withdraw.db` (9: BOARD_STAGES 7→1, ALREADY_ACTIVE, blank reason, leaves board) [transitions.test, withdrawal.test, board.test]; `review/judge.db` (9) [documents/judge-review.test, accepted-issuer.test, handler.test]; `review/manual-checks.db` (8) [requirements/manual-check.test, policy.test]; `review/exception-resolution.db` (8) [documents/staff-decision.test, policy.test]; `clearance/sign-off.db` (7) [requirements/clearance.test, transitions.test, policy.test]; `verification/background-check.db` (6) [requirements/background-check.test]; `verification/health-screening.db` (5) [requirements/health-screening.test, policy.test]; `verification/chrc.db` (5; keep "result before submission") [requirements/chrc.test, policy.test]; `review/exception-queue.db` (5) [documents/auto-accept.test, exception-queue.test, policy.test]; `review/caregiver-notice-job.db` (4) [staff-decision.test, handler.test]; `review/auto-accept-job.db` (4; keep name mismatch and no-judge-row) [auto-accept.test, handler.test]; `sync/alayacare-preview.db` (4) [domain/sync/alayacare-preview.test, alayacare-sync.test]; `sync/alayacare-mapping.db` (4) [policy.test, domain/sync/alayacare-mapping.test]; `verification/references.db` (4) [requirements/reference-check.test; link-token.db]; `intake/sensitive-sections.db` (4; keep SSN and direct deposit) [forms/sections/*.test, validation tests]; `clearance/clearance-sheet.db` (4) [clearance.test, policy.test]; `forms/signing.db` (4; keep not-ready) [document-set.test, envelope.test]; `intake/home-care-profile.db` (3) [intake-flow.test, sections/home-care-profile.test]; `caregivers/resend-invite.db` (3) [pipeline/invite.test]; `caregivers/invite-sms-job.db` (3) [invite.test, handler.test]; `intake/flow.db` (3) [forms/intake-flow.test]; `review/accepted-issuers.db` (3) [policy.test, accepted-issuer.test]; `review/weekly-sample.db` (3) [documents/weekly-sample.test, policy.test]; `verification/reference-jobs.db` (3) [reference-check.test]; `forms/void-envelope.db` (CHANGED_AT_PROVIDER 2→1; NOT_VOIDABLE 5→2, see P rule); `retention/retention-sweep-job.db` (2) [domain/retention/rules.test]; `integrations/queue/schedule.db` (2) [queue/schedule.test]; `forms/official-forms.db` (2) and `forms/agency-documents.db` (2) [documents/official-forms.test, agency-templates.test]; `documents/extraction-job.db` (2), `documents/uploads.db` (2) [handler.test, documents/upload.test]; `sync/alayacare-sync-job.db` (2) [alayacare-sync.test, alayacare-preview.test]; `reports/eeoc-report.db`, `reports/success-metrics.db`, `users/staff-users.db`, `caregivers/caregiver-detail.db` (roles → 1) [policy.test]; one each: `auth/context.db` [server/auth/context.test], `users/staff-invite-email-job.db` [handler.test], `caregivers/pipeline-board.db`, `caregivers/invite-link.db` [link-token.db], `caregivers/correct-mobile-phone.db` [pipeline/invite.test, validation/phone.test], `caregivers/email-verification.db` [link-token.db], `intake/rematerialise.db` [resolve.test], `intake/restricted-sections.db`, `auth/session.db` [domain/auth/credentials.test], `credentials/record-credentials.db` [requirements/credential.test], `forms/send-envelope-job.db`.

**P — pure tests in db files (move to the sibling `*.test.ts`):** `src/db/audit.db.test.ts` "AuditedTx removes exactly the restricted delegates and auditEntry" (type-level); `src/db/repositories/alayacare-mapping.db.test.ts` "repository imports nothing from restricted/crypto/EEOC/medical"; `src/db/repositories/requirement-templates.db.test.ts` "input type has no room for a derived field"; `src/db/repositories/link-tokens.db.test.ts` the `LINK_TOKEN_TTL_DAYS.STAFF_INVITE` pin (→ delete as F if `domain/auth` already pins TTLs); `src/integrations/adapters/messaging/mock.db.test.ts` "providerMessageId is a pure function of (agencyId, key)" (→ mock.test.ts); `src/server/auth/caregiver-session.db.test.ts` "no pending-code cookie is NO_CODE"; `src/server/forms/agency-documents.db.test.ts` "throws on a non-ISO issuedOn before reading".

**D — unit duplicates:** section-definition tests repeated by `src/domain/forms/intake-flow.test.ts` (parse + bindingIssues + captureOnce over ALL_SECTIONS): the "is a valid definition bound to the catalogue" and partial "captures each field once" tests in `src/domain/forms/{restricted,vaccination}.test.ts` and `src/domain/forms/sections/{chrc-descriptors,contact,education,emergency-contacts,employment-history,references,government-id,identity,home-care-profile,medical-questionnaire,eeoc-self-identification,payroll}.test.ts`; min/max-entries `it.each` in education/emergency-contacts/employment-history/references [validate.test above-max / below-min]; identity "exactly one message"/"malformed SSN" [validate.test, validation tests]; `domain/requirements/manual-check.test.ts` no-reason throw [manual-only.test]; `src/server/caregivers/reveal-sensitive-field.test.ts` role/reason/ForbiddenError/no-principal [policy.test, context.test] (keep "reaches the repository with the principal agency"); `src/integrations/adapters/messaging/mock.test.ts` no-subject email [ports/schemas.test]; `adapters/esign/mock.test.ts` foreign document key [ports/esign.test]; `adapters/storage/local.test.ts` hostile-key list → a few keys + sentinel check [ports/storage.test]; `src/app/(staff)/admin/mapping/source-options.test.ts` DENIED_NAMES + null parse [domain/sync/alayacare-mapping.test].

**Not to prune** (considered, kept): transition-table "exactly the N edges" guards in `pipeline/transitions.test.ts` and `requirements/instance-status.test.ts` (product decisions); `expectTypeOf` drift files in `src/server/sync/`; every concurrency, SKIP LOCKED, idempotency, rollback/atomicity, agency-scoping and cascade test; `seeds/ny-requirement-templates.test.ts` list-size pin (borderline — keep).

## Steps

1. On the untouched tree, own DB (`CREDORA_TEST_DB=credora_t143_<x>`): `db:test:setup`, then `vitest list --json` for all projects → `tests-before.txt`. → verify: line count ≈ 4,724.
2. Part A: `emptyAllTables` + renames; `testing.ts`; the two setup files; `vitest.config.mts`; devDependencies (`npm install -D -E pg@8.23.0 @types/pg@8.23.1`, lockfile must not change any other package). → verify: `npx vitest run --project db` green, wall-clock ≤ ~3 min; `select datname from pg_database where datname ~ '__w[0-9]+$'` shows none of yours afterwards; `npx vitest run` (all projects) runs without the groupOrder error; with `CREDORA_TEST_DB_HOST=127.0.0.2` (unreachable) `npx vitest run --project db` skips rather than fails.
3. Add to `src/db/maintenance.db.test.ts`: `emptyAllTables empties a linked graph` — agency, caregiver with satellites (factories), a seeded NY requirement template (RESTRICT FK), a requirement instance with evidence, an audit entry, a medical row → every table 0 after. Covers the risk that the children-first order is wrong. Update the AuditEntry test's name and comment in `audit.db.test.ts`.
4. Write `scripts/db-constraint-mutation.mjs`; run it → `mutation-before.json`. Record killed/survived counts.
5. Prune, category by category, reading each candidate and its counterpart first; write LEDGER rows as you go. Add the two CHECK tests. → verify after each category: `vitest related` for touched files.
6. `tests-after.txt`; `node docs/tasks/T-143-test-suite-diet/ledger-check.mjs` → exit 0.
7. `scripts/db-constraint-mutation.mjs --only mutation-before.json --also mutation-before.json --out mutation-after.json` → every before-killed object killed.
8. Docs: CONVENTIONS § Tests — "Isolation between database tests is truncation" becomes "is emptying every table before each test"; add that db files run in parallel on per-worker clones. ORCHESTRATION § Concurrent agents — clones `<base>__w<n>`, dropped at start and end of each run, one run per `CREDORA_TEST_DB` value, base `credora` refused; "`describeDatabase` truncates" → "empties". → verify: no other doc edited.
9. Final: full unit, ui and db suites once each, record Files/Tests/Duration; `npm run build`; `npm run lint`.

## Out of scope

- Extracting new pure functions from use cases to make a db test prunable (log instead).
- Changing any production behaviour, migration, or `schema.prisma`.
- Pool sizing, `CREDORA_TEST_WORKERS` or any other knob; `maxWorkers` is 4, fixed.
- Dropping the ~160 stale `credora_test_*` / `credora_chk_*` databases other agents left in the
  container — list them in REVIEW for the orchestrator; never drop a database this task did not create.
- Speeding up the unit or ui projects beyond what the prune gives.
- Filling FK/unique-index mutation survivors that already survive at baseline.

## Success criteria

- [ ] db suite ≤ ~3 min wall-clock on the shared container (baseline 25 min 11 s), all green
- [ ] `CREDORA_TEST_DB` still names the base DB `db:test:setup` migrates; unset still means `credora_test`; no clones remain after a run; `credora` refused
- [ ] `npm run test` with Postgres unreachable still skips the db suites green
- [ ] `ledger-check.mjs` exits 0; every R/D/P ledger row names a surviving test
- [ ] every object killed in `mutation-before.json` is killed in `mutation-after.json`; the two uncovered CHECKs are now killed
- [ ] REVIEW reports before/after files, tests, test LOC and wall-clock per suite (unit, ui, db)
- [ ] `npm run build` passes
- [ ] `vitest related` passes for every changed file, and the full unit, ui and db suites pass once
- [ ] `npm run lint` passes
- [ ] No file outside `writes:` was modified

## Tests to write

- `src/db/maintenance.db.test.ts` — `emptyAllTables empties a linked graph` (above) — risk: wrong delete order leaves rows or throws an FK violation.
- `src/db/maintenance.db.test.ts` — existing "clears medical and eeoc" and "leaves `_prisma_migrations`" kept, renamed to the new function.
- `src/db/audit.db.test.ts` — existing AuditEntry-clearing test, renamed — risk: DELETE would hit the append-only trigger.
- `src/db/repositories/uploaded-documents.db.test.ts` — an UPLOADED_DOCUMENT evidence row without `uploadedDocumentId` is rejected by `Evidence_uploaded_document_source`.
- `src/db/repositories/training.db.test.ts` — a TrainingCompletion with negative minutes is rejected by `TrainingCompletion_minutes_nonnegative`.
- `src/db/testing.db.test.ts` — existing isolation pair unchanged; it is the proof the per-test reset still fires.
- No test for the setup files themselves: the whole db suite running green on clones, and the unreachable-host skip check in Step 2, are their test.

## Risks and open questions

- **Stale clone after a migration mid-run** — clones are created from the base at file start
  within a run; a migration landing mid-run already breaks runs today (ORCHESTRATION). The
  global setup drops clones at start, so the next run is correct.
- **Concurrent CREATE DATABASE from one template** worked for 4 workers in the spike; if
  `55006 source database is being accessed by other users` ever appears, it means something is
  connected to the base — report it, do not add retries.
- **Flaky ui focus test** (`src/app/_components/sensitive.test.tsx`, `toHaveFocus`) failed once
  under combined load and passed twice on rerun. Not caused by this task; if it recurs in the
  final run, record it in REVIEW for the orchestrator rather than fixing it here.
- **schema-core is trimmed, not deleted**, contrary to the dag note's example — the kept tests
  are the only guards for tenancy, encryption-in-index and enum-mirror drift. Say so in REVIEW.
- **ADR-160** (orchestrator writes): *db test isolation is an ordered DELETE (AuditEntry
  TRUNCATEd) run before each test, and db files run in parallel on per-worker clones
  `<CREDORA_TEST_DB>__w<n>` of the migrated base.* Forcing constraint: TRUNCATE cost 794 ms of a
  ~1 s median test; suite 25 min. Rejected: per-test transaction rollback (three concurrency
  tests need committed multi-connection state; global client swap; nothing left to save once the
  reset is 5 ms); parallelism with TRUNCATE kept. Consequence: `maxWorkers: 4` and
  `sequence.groupOrder: 1` on the db project; `pg` becomes a devDependency; one run per
  `CREDORA_TEST_DB` value; supersedes the truncation wording of ADR-010 (the row-trigger
  rationale still holds for AuditEntry).
- No OPEN-QUESTIONS entry needed (260 unused).
