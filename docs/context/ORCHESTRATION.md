# Orchestration protocol

How the build runs. The orchestrator holds the graph; subagents hold one task each and never
see another's context. This file is the contract between them.

## Three tiers: master, batch orchestrator, task agents

One orchestrator holding the whole build runs out of context long before 80 tasks. So the
orchestration itself is split:

| Tier | Holds | Does |
| --- | --- | --- |
| **Master** (the top-level session) | `dag.mjs status` / `ready`, and one short report per finished batch | Picks the next batch, spawns **one** batch orchestrator for it, reads its report, repeats. Never spawns planners, implementors or checkers itself, and never reads plans, diffs or reviews. |
| **Batch orchestrator** (a subagent) | One batch: a phase, or a named set of task ids | Runs everything below for its batch — planners, implementors, checkers, shared-file serialisation, migrations, ADR allocation and transcription, commits — until every task in the batch is `done` or `blocked`. Returns a report of at most ~15 lines. |
| **Task agents** (planner, implementor, checker) | One task | Exactly as described in the rest of this file. |

Rules for the master:

- **One batch orchestrator at a time.** It owns the working tree, the migration lock, the
  commit boundary and the ADR number table; two would collide on all four.
- A batch is a **rolling frontier with a cap**, not a fixed set. It starts from the current
  `ready` frontier; as tasks finish, the batch orchestrator re-runs `dag.mjs ready` and starts
  any newly ready task, in any phase, until it has taken on ~8 tasks in total. Then it stops
  starting new ones, drains what is in flight, and reports. The cap bounds its context; the
  rolling intake means nothing ready sits idle behind an unrelated slow task.
- The next batch's planners do **not** start while the previous batch drains. Plans written
  against code still landing go stale, and a sent-back implementor costs more than the overlap
  saves.
- The batch orchestrator's report is the only thing the master reads: tasks done, tasks
  blocked and why, commits made, questions logged to `OPEN-QUESTIONS.md`, and anything the next
  batch must know. It does not paste plans, diffs or test output.
- Everything this file says "the orchestrator" does — ADRs, `MODULES.md` rows, conflict
  resolution, commits — is the batch orchestrator's job.
- The master stops and asks the user only under the conditions in `CLAUDE.md`; a batch
  orchestrator that hits one of them returns it in its report instead of asking.
- **A batch orchestrator must not end its turn to wait for a child.** Ending the turn is how a
  subagent finishes, so the child's result then lands on the master instead. When the last
  task agent in a batch is still running, run it in the foreground. If a stray child result
  reaches the master anyway, the master relays it with `SendMessage`.
- Obligations a batch discovers for later tasks go into those tasks' `notes` in `dag.json`, not
  only into the report. The report is read once; `notes` are read by every future planner.

Rules for every task agent a batch orchestrator starts, checkers included:

- Its own build output when builds overlap. Two concurrent `next build`s share `.next` and
  collide; serialise builds or give the second agent a separate worktree.

## Loop

```
node scripts/dag.mjs ready          → the frontier, N tasks that can run concurrently
for each task in the frontier:
    planner    → docs/tasks/T-0XX-<slug>/PLAN.md
    implementor→ code
    checker    → REVIEW.md, then: node scripts/dag.mjs set T-0XX done
repeat until `ready` is empty and `status` shows 80 done
```

Tasks in one wave are independent by construction, so their planners run concurrently, then
their implementors, then their checkers. Tasks that touch a shared file
(`schema.prisma`, `policy.ts`, `env.ts` — see `MODULES.md`) are serialised within the wave.

## The context discipline

This is the point of the whole file system. Each subagent gets a **manifest, not a codebase**.

| Agent | Receives | Must not |
| --- | --- | --- |
| Planner | Task id, title, deps · the **one** PRD section cited in `dag.json` · the context files its phase needs · the `PLAN.md` of any dependency whose public surface it must use | Read the PRD end to end. Read the whole `src/` tree. |
| Implementor | `PLAN.md` only. Its `reads:` list is the complete required reading. | Search the codebase. Expand scope. Refactor adjacent code. |
| Checker | `PLAN.md`, the diff, `CONVENTIONS.md` | Add features. Rewrite the design. |

An implementor that needs to grep has been given a bad plan. The fix is the manifest, not the
grep. Plans are cheap; context rot is not.

## Prompts

### Planner

> You are planning task **T-0XX — <title>** for Credora.
>
> Read, and only these:
> - `docs/PRD.md` § **<section from dag.json>** — that section only
> - `CLAUDE.md`, `docs/context/ARCHITECTURE.md`, `docs/context/DOMAIN.md`, `docs/context/CONVENTIONS.md`
> - <phase-specific context files>
> - <`docs/tasks/T-0YY-*/PLAN.md` for each dependency whose interfaces this task consumes>
>
> Write `docs/tasks/T-0XX-<slug>/PLAN.md` following `docs/tasks/_TEMPLATE.md` exactly.
>
> The `reads:` manifest is the deliverable that matters most. The implementor will read those
> files and nothing else — if it is incomplete they will guess; if it is bloated you have
> wasted the context you were saving. Name symbols, not just paths.
>
> Quote the PRD bullets verbatim. Anything you do not quote is out of scope.
> State the exact exported signatures other tasks will import.
> Do not write implementation code in the plan.

### Implementor

> You are implementing task **T-0XX** for Credora.
>
> Read `docs/tasks/T-0XX-<slug>/PLAN.md`, then exactly the files in its `reads:` list.
> Do not search the codebase. Do not read the PRD.
>
> Write only the files in `writes:`.
> Follow `docs/context/CONVENTIONS.md`: no `any`, no defensive `try/catch`, no speculative
> abstraction, no comments restating code, minimum code that satisfies the quoted bullets.
>
> If the plan is wrong or incomplete, stop and report what is missing. Do not improvise
> around it — a wrong plan followed silently costs more than a plan sent back.
>
> Run `npm run build` and `npm run lint` before you finish.
>
> Do not write `REVIEW.md` — that is the checker's file.

### Checker

> You are checking task **T-0XX** for Credora.
>
> Read `docs/tasks/T-0XX-<slug>/PLAN.md` and `docs/context/CONVENTIONS.md`, then
> `git diff` for this task's changes.
>
> **Verify.** Run `npm run build` and `npm run lint`. For each PRD bullet quoted in the plan,
> confirm the code satisfies it and say how you confirmed it.
>
> **Then refactor, by deleting.** Remove: dead code and unused exports; abstraction with one
> caller; `try/catch` that only rethrows or logs; branches guarding states that cannot occur;
> comments that restate the code; leftover scaffolding, console logs, and commented-out code;
> options and parameters nobody passes.
> Do not add features. Do not restructure working code
> for taste.
>
> Confirm nothing outside `writes:` changed. Re-run build and lint after your deletions.
>
> Write `REVIEW.md` in the shape given in `docs/tasks/README.md`, then run
> `node scripts/dag.mjs set T-0XX done`. That command regenerates `docs/PROGRESS.md`
> deterministically and is the *correct* way to record status — the standing prohibition is
> on hand-editing `docs/PROGRESS.md`, never on running `dag.mjs`.
>
> If a success criterion fails and you cannot fix it within the plan's scope, set the status
> to `blocked` instead and say exactly what is wrong.

## The loop does not pause for approval

See `CLAUDE.md` § "The orchestrator runs the build without being prompted". After each checker
sets `done`: commit, re-run `dag.mjs ready`, start the next batch. Planners for independent
tasks run concurrently; implementors that share a file (`schema.prisma`, `env.ts`,
`policy.ts`, `registry.ts`) are serialised. No turn ends waiting for a confirmation the build
does not need.

## Never `git add -A` while an agent is running

The orchestrator has twice swept a running implementor's half-finished files into an unrelated
commit this way. Nothing was lost, but the commit boundary was wrong and a partial state was
recorded as if it were finished work.

**Stage explicit paths**, taken from the finished task's `writes:` list:

```bash
git add src/db/repositories src/integrations/queue docs/context/DECISIONS.md
```

`git add -A` is only safe when `dag.mjs status` shows nothing `implementing` or `checking`.

**Anyone else committing while a batch runs — the master included — uses a pathspec:**
`git commit -- <paths>`. The batch orchestrator keeps finished tasks' shared files staged to
freeze them, and a plain `git add <paths> && git commit` commits that whole index. The master's
`2a466cf` swept T-113's migration, schema and policy rows into a process-doc commit this way.

## Migrations take a global advisory lock

`prisma migrate dev` takes `pg_advisory_lock(72707369)` on the **server**, not the database, so
two agents cannot migrate at once. So: only one agent runs a
migration at a time. A killed migration leaves the lock held and the next attempt dies with
`P1002`; terminate the idle backend rather than restarting the container, which other agents
are using.

**Correction (batch after T-032).** The earlier symptom, "`npm run db:migrate` does nothing and
creates no migration directory", was not the lock. `scripts/db-migrate.mjs` spawned `npx.cmd`
without a shell, which Node 24 refuses on Windows (`EINVAL`), so every run failed before Prisma
started. The script now runs the Prisma CLI through `process.execPath` and works. If a migration
still produces nothing, look for a lock holder first, then retry once with
`npx prisma migrate dev --name <name>`.

A checker verifying drift should prefer the read-only `prisma migrate diff` over `migrate dev`
— it answers the same question and takes no lock.

## The orchestrator writes the ADRs

`DECISIONS.md` is append-only and every task wants to append to it, which makes it the one file
that serialises otherwise-independent implementations. So **implementors do not touch
`DECISIONS.md`**. A plan states the decision, its forcing constraint, what was rejected and the
consequence; the orchestrator writes the entry when the task lands. Keep `DECISIONS.md` out of
every `writes:` list.

## ADR numbers are allocated, not claimed

With several planners in flight, two plans will pick the same next ADR number. The orchestrator
allocates; a planner writes `ADR-NNN (allocated)` only after the number appears below, and a
planner that needs one without an allocation writes `ADR-<next free>` and flags it.

| Number | Owner | Subject |
| --- | --- | --- |
| 001–011 | — | issued; see `DECISIONS.md` |
| 012 | orchestrator | status→presentation binding moves to `src/app/_lib/` (executed by T-032) |
| 013 | T-012 | field-encryption envelope, single key, no V1 rotation |
| 014 | T-030 | platform-owned requirement templates exempt from agency scoping |
| 015 | T-013 | audit log: append-only trigger, branded transaction, restricted-delegate narrowing |
| 016–017 | T-017 | storage key convention; local disk is this port's mock (no separate `mock.ts`) |
| 018 | T-016 | job queue on Postgres, no new infrastructure; lease-based recovery |
| 019 | T-011 | medical content in keyed answer rows; EEOC has no per-caregiver reader |
| 020 | T-014 | the role ceiling, `defineUseCase`, and the use-case coverage test |
| 021 | T-015 | pipeline transitions; why `PipelineEvent` and `AuditEntry` both exist |
| 022 | T-010b | the db mapping boundary owns every crypto call site |
| 023 | T-016 | Postgres job queue with SKIP LOCKED, no new infrastructure |
| 024 | T-014 | `AuditedTx` also omits `auditEntry`; entries only via `writeAuditEntry` |
| 025 | T-019 | one audited reveal door behind one use case; decrypt lint exemption by file, not directory |
| 026 | T-020 | staff cookie holds only ids; principal rebuilt from the `User` row each request; bcrypt cost 12 |
| 027 | T-022 | link tokens: hashed random bearer capabilities, consumed by conditional update; `defineLinkUseCase` runs as SYSTEM |
| 028 | T-032 | requirement instances frozen and additive; one FK per evidence kind, deferred where a cascade reaches it |
| 029 | T-018 | recurrence as `JobSchedule`; latest due occurrence only; `CANCELLED` state |
| 030 | T-050 | all port slots declared; empty slot throws `PortNotAvailableError` |
| 031 | T-050 | port env vars declared up front; registry validates adapter names |
| 032 | T-055 | background-check `packageCode` stays opaque |
| 033 | T-055 | background-check mock: in-memory, dev-control-driven, self-signed |
| 034 | T-040 | intake form definitions are code-declared data, gated by requirement template keys |
| 035 | T-054 | judge model and parameters: `claude-opus-5`, no sampling params, no fallbacks |
| 036 | T-054 | judge reasons are grounded quotes verified against the input |
| 037 | T-060 | the document set is a projection of requirement instances |
| 038 | T-052 | the e-sign port carries the whole document set |
| 039 | T-052 | the e-sign mock keeps state as JSON files under `STORAGE_ROOT/_mock-esign/` |
| 040 | T-052 | dev-only `*.dev.tsx` pages may import mock adapters |
| 041 | T-077 | issuer allowlist is agency-owned, exact match after normalisation |
| 042 | T-051 | a mock adapter may persist through a `src/db/repositories` module |
| 043 | T-051 | `listOutboxMessages` is a declared unscoped read |
| 044 | T-058 | webhook agency resolved via `WebhookSubject`, a declared unscoped read |
| 045 | T-058 | webhook receipt: verify first, 409 unknown, body-hash dedupe, two idempotent writes |
| 046 | T-057 | training mock: committed CSV fixtures, hand-written parser |
| 047 | T-056 | AlayaCare mock is an out-of-process HTTP server; adapter is an HTTP client |
| 048 | T-056 | AlayaCare wire format invented; each side owns its wire schemas |
| 049 | T-056 | AlayaCare mock vendor semantics |
| 050 | T-062 | agency documents are code-declared versioned templates, pdf-lib standard fonts |
| 051 | T-120 | pipeline list view not audited per caregiver |
| 052 | T-047 | capture-once binding by canonical field name |
| 053 | T-047 | repeating rows keep identity via `_rowId` |
| 054 | T-033 | seed modules may import `src/domain`; client-parameter template writer |
| 055 | T-033 | training minimums as `RequirementTemplate.minimumMinutes` |
| 056 | T-033 | NY library: service type = aide service; agency policy copied per agency |
| 057 | T-021 | caregiver auth messages sent synchronously (Rule 5 exception) |
| 058 | T-021 | sign-in resolves tenant by mobile phone; ambiguity sends nothing |
| 059 | T-021 | caregiver session and one-time-code parameters |
| 060 | T-021 | email verification bound to the sent-to address |
| 061 | T-025 | code request responds after the phone lookup only; encrypted pending-code cookie always issued |
| 062 | T-043 | keyed-by-anchor collections; duplicate anchors rejected at save |
| 063 | T-059 | adapter names checked at server boot; empty-slot error retired |
| 064 | T-084 | Hep B and flu are FORM requirements printing the recorded choice |
| 065 | T-084 | vaccination statements as Standard columns on HomeCareProfile |
| 066 | T-046 | sealed on-file via IS NOT NULL projection, one reader |
| 067 | T-046 | work-authorisation type as one combined code |
| 068 | T-070 | clinic results under a restricted clinical storage kind |
| 069 | T-061 | second decrypt door for official forms, audited per field, one importer |
| 070 | T-061 | official forms as pinned government PDFs; SAMPLE pages where no blank exists |
| 071 | T-044 | invite text is a queued job that mints its link at send |
| 072 | T-044 | resolution context stored on Caregiver at invite; instances built then |
| 073 | T-044 | applyPipelineTransition is the only writer of Caregiver.stage |
| 074 | T-044 | SMS consent first captured by staff at offer acceptance |
| 075 | T-110 | AlayaCare mapping as one versioned JSON document per agency |
| 076 | T-110 | mapping sources Standard tier only; vaccination answers excluded |
| 077 | T-064 | envelope send is two steps: guarded generate, system job calls vendor |
| 078 | T-064 | caregiver is the only signer; signed copy satisfies without review |
| 079 | T-124 | withdrawal cancels no job; workers re-check stage at run time |
| 080 | T-041 | intake FORM instances satisfied by Attestation evidence |
| 081 | T-041 | one ordered ALL_SECTIONS list; store chosen only in storeFor |
| 082 | T-071 | clinic OCR text in the medical store; extracted fields in core |
| 083 | T-071 | extraction stored as printed; normalised on read |
| 084 | T-045 | restricted intake sections: form engine yes, canonical binding no; EEOC write-only |
| 085 | T-132 | seed-only tsconfig maps server-only; seed loads the real server stack |
| 086 | T-132 | demo caregivers produced only by the product's use cases |
| 087 | T-048 | mobile number not editable in intake |
| 088 | T-048 | caregiver may withdraw, not grant, SMS consent |
| 089 | T-134 | the job worker: a separate long-running process draining the queue (resolves OPEN-QUESTIONS 18 by default) |
| 090 | T-072 | intake is the identity anchor; documents matched against intake alone |
| 091 | T-072 | names agree by token sequence over intake parts |
| 092 | T-072 | ID numbers not compared while no identity-document requirement exists |
| 093 | T-076 | CHECK_RESULT evidence arm; manual-only checks satisfied only by a staff record |
| 094–096 | T-122 | caregiver detail view: VIEW audit on open; invite resend and mobile correction; envelope void |
| 097–099 | T-073 | judge orchestration (see its plan) |
| 100 | T-080 | CHRC submission tracked as its own row; result reuses CHECK_RESULT |
| 101–102 | T-074 | auto-accept decision record and instance move; what counts as a confident extraction |
| 103–104 | T-100 | clearance readiness rule; clearance screen as its own route under clearance.view |
| 105–106 | T-121 | exception queue content and restricted-data limits; stalled review jobs listed |
| 107–108 | T-102 | credential projection from satisfied instances; recorded once at sign-off |
| 109 | T-075 | weekly sample computed on read, seeded by ISO week |
| 110–112 | T-123 | staff document decisions and waiver; DOCUMENT_REVIEW_CLEARED from one function; dead e-sign/notice jobs retried from the queue |
| 113–115 | T-101 | VERIFICATION_COMPLETED from one function; sign-off as event + audit entry; sync.alayacare job type |
| 116–118 | T-111 | AlayaCare sync log; idempotency keys from jobId; stage rule and fixed profile projection |
| 119–120 | T-115 | AlayaCare document allowlist inside the sync job; issuer on the port credential |
| 121 | T-140 | EEOC report: suppressed marginals, suppression inside the restricted accessor |
| 122–127 | T-081 | background-check mock on files (supersedes ADR-033 in-memory); nullable CheckResult recorder; BackgroundCheckOrder; staff order with double FCRA gate; per-order poll schedule; agency package code |
| 128–130 | T-083 | result creates MedicalFile root; health screening satisfied only by supervisor PASS; resultedOn column |
| 131–133 | T-024 | STAFF_INVITE link tokens; last-admin rule with agency row lock; USER audit entity |
| 134 | T-081b | staff clear (SATISFIED, staff-recorded CheckResult) or fail (EXCEPTION) a CONSIDER result |
| 135 | T-131 | caregiver self-view: what it shows and withholds |
| 136 | T-112 | AlayaCare sync preview is informational, not a gate |
| 137–138 | T-036 | role scope axis and layer; re-materialisation on profile change |
| 139–141 | T-082 | reference requests (see its plan) |
| 142–144 | T-023 | staff TOTP MFA (see its plan) |
| 145–147 | T-113 | AlayaCare sync conflicts (see its plan) |
| **148** | **next free** | |

## Orchestrator responsibilities

Things no subagent does:

- Owns `docs/dag/dag.json`. Subagents change status only via `scripts/dag.mjs`.
- Decides the frontier and what runs concurrently.
- Resolves conflicts between tasks in the same wave that touch shared files.
- Appends to `DECISIONS.md` when a task forces a real decision.
- Adds a row to `MODULES.md` when a task creates a new directory.
- Adds an entry to `AGENTIC-TASKS.md` if an LLM use is ever proposed — and rejects it by
  default.
- Recovers a `blocked` task: re-plan, or split it and update the graph.

## Failure handling

| Symptom | Response |
| --- | --- |
| Implementor reports the plan is wrong | Re-run the planner with the implementor's objection appended. Do not let the implementor plan. |
| Checker sets `blocked` | Read `REVIEW.md`. Either fix the plan and re-run the implementor, or split the task and update `dag.json`. |
| Two tasks in a wave conflict on a shared file | Serialise them; the second implementor reads the first's diff. |
| A task turns out to need something not yet built | That is a missing edge. Add it to `deps` in `dag.json`, set the task back to `pending`, re-validate. Never work around it. |
