---
task: T-133
slug: e2e-happy-path
title: "End to end: offer accepted through to active in AlayaCare, against mocks"
prd: "Target workflow"
reads:
  # THE COMPLETE required reading. Do NOT grep src/ broadly. Page directories below are listed
  # so you can read the markup that the selectors come from; open only the page you are driving.
  - docs/PRD.md                                   # § "## Target workflow" ONLY (the mermaid + stage table).
  - docs/context/CONVENTIONS.md                   # § Tests, § UI (375px, 44px targets, keyboard-navigable staff app).
  - docs/context/INTEGRATIONS.md                  # § Ports (mock behaviours), § Env vars, § The AlayaCare mock.
  - docs/context/ORCHESTRATION.md                 # § "Concurrent agents get their own test database" (lines 169-192).
  - docs/dag/dag.json                             # the T-133 entry's `notes` ONLY — binding; every clause is a step below.
  - package.json                                  # scripts; you add `e2e` and two devDependencies.
  - .env.example                                  # the APP_URL comment is the one line you change.
  - next.config.ts                                # you add `distDir` (Design 3). Keep the devOnlyPageExtensions comment intact.
  - tsconfig.json                                 # you add ".e2e" to `exclude` (Design 3).
  - eslint.config.mjs                             # globalIgnores: you add ".e2e/**".
  - .gitignore                                    # you add "/.e2e/".
  - vitest.config.mts                             # read-only: confirms `e2e/` is outside every project's `include` (no change needed).
  - src/lib/env.ts                                # APP_URL line (Design 6).
  - src/lib/env.test.ts                           # lines 75-95: the APP_URL tests you extend.
  - scripts/worker.ts                             # read-only: `npm run worker`; loads .env with --env-file-if-exists, process env wins.
  - scripts/db-migrate.mjs                        # read-only: pattern for running the Prisma CLI through node (no npx.cmd).
  - prisma/seed.ts                                # read-only: prints staff + demo caregivers; refuses NODE_ENV=production.
  - src/db/seeds/alvita.ts                        # lines 20-30: the four staff emails; `DEMO_STAFF_PASSWORD` (alvita-demo-2026).
  - src/server/dev/demo-seed.ts                   # DEMO_CAREGIVERS: Maria Santos +12125550181 (INTAKE, 2 fixture uploads), Grace Mensah +12125550182 (INTAKE), Andre Joseph +12125550183 (INVITED, PCA). Read-only.
  - src/integrations/adapters/messaging/fixtures/recipients.ts   # REJECTED_RECIPIENTS — never use these for references.
  - src/integrations/adapters/extraction/fixtures/  # by NAME only: hha-certificate.pdf, ppd-tb-result.pdf, ny-drivers-license.pdf. Identity "Maria Elena Santos", DOB 1988-03-14. Upload these files by path from the spec.
  - mock-servers/alayacare/server.ts              # port from ALAYACARE_BASE_URL; in-memory state (restart = reset).
  - mock-servers/alayacare/app.ts                 # lines 226-260 (routes: GET /<agencyId>/employees/<id>/documents) and 290-300 (fault schedule: 429/503 — your own GETs count, retry them).
  - mock-servers/alayacare/seed.ts                # emp-0001 Maria Santos 1980-04-12 — the conflict partner.
  - src/app/dev/outbox/page.dev.tsx               # how SentMessage bodies are rendered (link + code extraction).
  - src/app/dev/background-check/page.dev.tsx     # advance controls (CLEAR / CONSIDER).
  - src/app/dev/esign/[envelopeId]/page.dev.tsx   # "Sign all N documents"; posts the webhook to env.APP_URL.
  # Selector sources — read the page (and its sibling components) you are driving, when you drive it:
  - src/app/login/                                # page.tsx, mfa/page.tsx, mfa/setup/page.tsx (key display, recovery codes).
  - src/app/r/staff-invite/[token]/               # staff invite acceptance.
  - src/app/r/invite/[token]/                     # caregiver invite landing.
  - src/app/verify/                               # page.tsx (phone), code/page.tsx (code).
  - src/app/r/reference/[token]/                  # reference form (Yes/Yes, No).
  - src/app/(caregiver)/                          # intake/[step], documents, documents/[instanceId], sign, record, email.
  - src/app/(staff)/caregivers/new/               # invite form.
  - src/app/(staff)/caregivers/[id]/              # record page, withdraw (T-138), alayacare/ preview (T-112).
  - src/app/(staff)/pipeline/                     # stage <h2>, caption, columns.
  - src/app/(staff)/queue/                        # section headings, Decide / Waive dialogs, Retry.
  - src/app/(staff)/sample/                       # <h2> "Week of ...", caption "Sampled documents".
  - src/app/(staff)/checks/                       # FCRA/background check order, CONSIDER clear/fail, references Send request / Satisfy / Fail.
  - src/app/(staff)/clearance/                    # [id]: Record result (health), Sign-off section + dialog, preview alert.
  - src/app/(staff)/sync/                         # conflict list, [caregiverId]: link, OURS/THEIRS selects, Retry.
  - src/app/(staff)/admin/users/                  # invite staff, "Reset two-step sign-in".
  - src/app/(staff)/admin/requirements/           # list, new (role scope picker).
  - src/app/(staff)/training/page.tsx             # smoke.
  - src/app/(staff)/reports/metrics/page.tsx      # smoke.
  # Flow facts (read the named sections only):
  - docs/tasks/T-023-mfa-totp/REVIEW.md           # lines 115-131: enrolment, the TOTP one-liner, one-use codes, lockout reset.
  - docs/tasks/T-044-invite-flow/REVIEW.md        # lines 150-175: invite → /verify → back to /r/invite.
  - docs/tasks/T-082-reference-requests/REVIEW.md # lines 105-125: the T-133 handoff (references walk).
  - docs/tasks/T-081-background-check-flow/REVIEW.md   # lines 35-60 and 205-220: FCRA gate, order, advance.
  - docs/tasks/T-113-sync-conflicts/REVIEW.md     # lines 4-20: the reproduced conflict walk (Maria Santos 1980-04-12).
  - docs/tasks/T-115-sync-credentials-documents/REVIEW.md  # lines 25-35 and 68-75: allowlist, excluded keys, T-133 handoff.
  - docs/tasks/T-112-sync-preview/REVIEW.md       # lines 4-22: alert sentence, who sees the link.
  - docs/tasks/T-123-exception-resolution/REVIEW.md    # lines 160-215: what Retry covers; T-133 handoff.
  - docs/tasks/T-036-role-axis-rematerialisation/REVIEW.md  # lines 5-7 and 27-28: what re-points and what stays.
  - docs/tasks/T-101-supervisor-signoff/REVIEW.md # the T-133 handoff (dialog, focus, 375px).
  - docs/tasks/T-120-pipeline-dashboard/REVIEW.md # the T-133 handoff (headings, caption, columns).
  - docs/tasks/T-131-caregiver-self-view/REVIEW.md    # what /record shows (masking, EEOC, nav).
  - docs/tasks/T-034-template-admin-ui/REVIEW.md  # how "add" and the role scope are entered; ambiguity refusal.
writes:
  - e2e/playwright.config.ts                      # new
  - e2e/global-setup.ts                           # new: fresh credora_e2e, migrate, seed, build, spawn 4 processes, teardown
  - e2e/support/totp.ts                           # new: RFC 6238 code from a base32 key (node:crypto)
  - e2e/support/harness.ts                        # new: outbox reader, staff sign-in with MFA, pg read helper, mock GET with 429/503 retry, dev-origin rewrite
  - e2e/happy-path.spec.ts                        # new: the checklist below, serial
  - package.json                                  # "e2e" script; devDependencies @playwright/test, pg, @types/pg
  - package-lock.json
  - next.config.ts                                # distDir from CREDORA_DIST_DIR
  - tsconfig.json                                 # exclude ".e2e" (and any include lines next build adds for it — keep them, see Risk 2)
  - eslint.config.mjs                             # globalIgnores ".e2e/**"
  - .gitignore                                    # /.e2e/
  - .env.example                                  # APP_URL comment: required when NODE_ENV=production
  - src/lib/env.ts                                # APP_URL required in production
  - src/lib/env.test.ts                           # two cases
  # Product fixes the run finds: only under § Out of scope's "fix line"; add each path here in your handoff.
depends_on: [T-064, T-074, T-101, T-115, T-120, T-123, T-132, T-124, T-048, T-134, T-135, T-137, T-138, T-143]
---

# T-133 — End to end: offer accepted through to active in AlayaCare, against mocks

## What this task must produce

A committed, re-runnable browser run (`npm run e2e`) that takes caregivers from an accepted offer
(coordinator invite) through SMS invite, mobile intake, e-signature, document review with the staff
queue, verification (background check, references, health screenings), supervisor clearance and sync
to the AlayaCare mock, to Active — against every mock, on a fresh `credora_e2e` database, a production
build, the worker and the AlayaCare mock. The run also covers the staff-side surfaces the checkers of
T-023/T-036/T-048/T-075/T-081b/T-082b/T-101/T-112/T-113/T-115/T-120/T-121/T-123/T-124/T-131/T-138 could
not browser-verify, and it produces the facts the checker records in REVIEW.md: what passed, what the
run found, and what a driver cannot verify.

## PRD requirements covered

`docs/PRD.md § Target workflow`:

- > "The caregiver moves through one tracked pipeline from accepted offer to active in AlayaCare."
- > "Offer triggers an SMS invite and a tracked record"
- > "One mobile flow; each field entered once; forms generated and sent for e-signature"
- > "In-flow upload with automatic extraction"
- > "Rule-based matching across documents; an LLM judge checks each home-care record is unexpired and from a legitimate issuer; staff handle exceptions"
- > "Vendor integration and automated reference requests"
- > "One clearance view with every requirement and its status"
- > "Automatic sync to the agency's AlayaCare configuration, including expiry dates"

(Training: "Hours ingested and checked against state minimums" is smoke-only here — `/training`
renders; ingestion was proven by T-090.)

## Design

### 1. Driver: `@playwright/test` driving the installed Microsoft Edge (ADR-161)

No browser driver is in `node_modules` (only a stray `@puppeteer` folder, empty, not in `npm ls`).
Microsoft Edge is installed (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) and a
Playwright browser cache exists but its revision is not tied to any installed package. Add
`@playwright/test` (latest, 1.63.x) as a devDependency and set `use.channel: 'msedge'` in the config,
so no browser is downloaded and no `npx playwright install` is part of the run. Add `pg` and `@types/pg`
as devDependencies at the versions already in `node_modules` (8.23.x, transitively present via
`@prisma/adapter-pg`) — the spec and setup use them for three things only: dropping `credora_e2e`,
asserting the `AlayaCareSync` row, and nothing else (every other assertion is through the UI).
Record as **ADR-161** (orchestrator writes it): Playwright over a one-off manual walk because the run
must be repeatable after later tasks; `channel: 'msedge'` because Edge is present and a download is an
outward-facing action; `pg` because the setup must drop a database and Prisma is confined to `src/db/`.

### 2. Process topology — all under one Playwright `globalSetup` (returns its teardown)

`npm run e2e` = `playwright test -c e2e/playwright.config.ts`. Not `webServer`: the database must be
migrated and seeded, and the build finished, before any server starts, and there are four processes
with a shared env. `e2e/global-setup.ts`, in order:

1. Refuse to run unless the target is literally `credora_e2e` (a constant, asserted). URL:
   `postgresql://credora:credora@127.0.0.1:5433/credora_e2e`. Never the name `credora`; never
   `prisma migrate reset`; never touch the container (no `docker` commands at all).
2. Fail fast if any of ports 3310, 3311, 4011 is already listening.
3. `DROP DATABASE IF EXISTS credora_e2e WITH (FORCE)` through `pg` connected to the `postgres`
   maintenance database; `rm -rf .e2e/storage`.
4. `prisma migrate deploy` (through node, as `scripts/db-migrate.mjs` does) — it creates the database.
5. `npm run db:seed`.
6. `next build` (with `CREDORA_DIST_DIR=.e2e/next`).
7. Spawn, each with stdout/stderr to `.e2e/logs/<name>.log`:
   - `next start -p 3310` (`CREDORA_DIST_DIR=.e2e/next`)
   - `next dev -p 3311` (`CREDORA_DIST_DIR=.e2e/next-dev`) — dev-only pages, see § 4
   - `npm run worker`
   - `npm run mock:alayacare`
8. Wait for 3310, 3311 (first request to `/dev/outbox`, which compiles it), 4011 to answer.
9. Teardown kills each child's process tree (`taskkill /pid <pid> /T /F` on win32).

Every step and every process gets the same explicit env, which wins over `.env` for Next, tsx
(`--env-file-if-exists`) and `prisma.config.ts` alike:

```
DATABASE_URL=postgresql://credora:credora@127.0.0.1:5433/credora_e2e
STORAGE_ROOT=./.e2e/storage
APP_URL=http://localhost:3310          # app, dev server AND worker — texted links are built on it
ALAYACARE_BASE_URL=http://127.0.0.1:4011   # not 4010: a dev mock may be running there, and its state is in memory
*_ADAPTER=mock, STORAGE_ADAPTER=local  # explicit, not inherited
```

`FIELD_ENCRYPTION_KEY` and `SESSION_SECRET` come from `.env` unchanged (identical for all four
processes — the dev server must read the same stored ciphertext and cookies).

### 3. Why a separate `distDir`

The orchestrator's checkers run `npm run build` (into `.next`) while batches run, and a `next dev` on
:3000 may hold `.next/dev/lock`. A build into `.next` mid-run would swap chunks under `next start`;
a second `next dev` in the same dist dir refuses to start ("Another next dev server is already
running"). So `next.config.ts` gains `distDir: process.env.CREDORA_DIST_DIR ?? '.next'` — unset, nothing
changes. Start and dev get different dirs (`.e2e/next`, `.e2e/next-dev`) so neither can clobber the
other whatever Next's dev isolation does. `CREDORA_DIST_DIR` is a build-tool variable read only by
`next.config.ts` (as `NODE_ENV` already is there); it is not an app env var and does not go in
`src/lib/env.ts` or `.env.example`. Everything generated lives under `.e2e/` (gitignored, eslint-ignored,
tsconfig-excluded): the two dist dirs, storage, logs, Playwright `outputDir` and HTML report.

### 4. How the dev-only pages are reached: a second `next dev` on :3311, same DB/storage/APP_URL

`.dev.tsx` pages are not compiled into a production build (ADR-122). Three are needed:

- `/dev/esign/[envelopeId]` — the signing page itself. It stands in for the vendor and has no
  production route, so the caregiver cannot sign under `next start` at all; reading the database cannot
  substitute for pressing "Sign all N documents". This alone forces a dev server.
- `/dev/background-check` — the advance control. It posts a signed webhook to `env.APP_URL`, i.e. the
  `next start` server, so the product path under test stays the production build.
- `/dev/outbox` — the caregiver's "phone". Using it (not SQL) keeps the invite link followed exactly as
  rendered, which is what the master asked for.

Because the dev server's `APP_URL` is also `http://localhost:3310`, the e-sign mock's signing URL and
every webhook point at the production server. The spec rewrites only URLs whose path starts with
`/dev/` to origin `:3311` (one helper, `devUrl()`); every other link is followed as given. Cookies are
per host, not per port, so the staff and caregiver sessions are the same on both. REVIEW must say that
the `/sign` → signing-page hop was rewritten by the harness, and why (a mock artefact, not a finding).

### 5. Spec shape

One file, `test.describe.configure({ mode: 'serial' })`, one `test` per numbered group below with
`test.step` per item, generous timeouts (whole file ≈ 30 min budget; each worker-dependent wait is an
`expect.poll`/`toPass` with reload, ≤ 3 min). One browser context per actor, created once and kept:
coordinator, supervisor, admin, implementation, invited staff user, and one per caregiver (caregivers
at 375×812 with `isMobile`/`hasTouch`; staff at 1280×800 unless a step says 375). This means each staff
user passes MFA once; repeat sign-ins (steps 1.3, 1.4) track the last accepted TOTP step per user and
use a stored recovery code instead of waiting when the step would repeat.

Caregivers (ids captured from URLs, never located by name alone — there are three "Maria Santos"):

| Actor | Who | Why |
| --- | --- | --- |
| **A** | seeded Maria Santos, +12125550181 (INTAKE, 2 fixture uploads with extraction queued) | the fixture identity (Maria Elena Santos, 1988-03-14): auto-accept, /sample, first SYNCED, Active, /record |
| **B** | new invite: Maria Santos, DOB **1980-04-12**, +12125550192, HHA | invite link walk, Contact section, queue accept/reject/waive, reference No → Satisfy, CONSIDER → clear, conflict with emp-0001 → SYNCED → Active |
| **C** | seeded Grace Mensah, +12125550182 (INTAKE) | T-036 certification change, CONSIDER → fail, envelope retry, withdrawal on /caregivers/[id] |

Reference phones: +12125550171..+12125550176 (not in `REJECTED_RECIPIENTS`); no employer marked
"May we contact this employer? No" shares a name or supervisor phone with a reference.

### 6. APP_URL is required in production (T-052 note, binding)

`src/lib/env.ts`: `APP_URL` keeps its `http://localhost:3000` default outside production and has no
default when `NODE_ENV === 'production'` (a boot failure naming APP_URL). `.env.example`'s comment says
so. The e2e run exercises it: `next build`/`next start` get `APP_URL` explicitly.

## Steps (the checklist — each numbered item is a `test.step` with the assertion shown)

**0. Harness**
0.1 Setup as § 2 → verify: seed log lists the 4 staff and 3 CREATED caregivers; all four ports answer;
    `SELECT current_database()` through the app's DB is `credora_e2e` (the spec's `pg` helper refuses any other name).

**1. Staff sign-in, MFA, staff invite (T-023, T-024)**
1.1 Each of coordinator, supervisor, admin, implementation @alvita.test signs in with `alvita-demo-2026`
    → lands on `/login/mfa/setup`; the spec reads the key, computes the TOTP (`e2e/support/totp.ts`,
    RFC 6238 SHA-1 30 s 6 digits), stores the ten recovery codes → verify: signed-in staff home.
1.2 Replay: the implementation user signs out and in again within the same step → the just-used TOTP is
    refused; a recovery code is accepted.
1.3 Lockout: implementation user enters ten wrong codes → locked message even for the right code; admin
    presses "Reset two-step sign-in" on `/admin/users`; implementation signs in → `/login/mfa/setup` again.
1.4 Staff invite: admin invites `e2e.coordinator@alvita.test` (COORDINATOR) on `/admin/users`; worker
    sends; the spec reads the `/r/staff-invite/<token>` link from `/dev/outbox`, sets a password →
    verify: lands on `/login/mfa/setup`, enrols, reaches staff home.

**2. Admin smoke and the role-scoped rule (T-034, T-036 set-up)**
2.1 Admin `/admin/requirements` renders its list; `/admin/requirements/new` adds one agency-layer rule
    scoped to role = HHA for a requirement that no NY rule scopes by role (choose from the form's options;
    T-034 REVIEW names what is accepted) → verify: listed; resolver preview shows it; not refused as ambiguous.
    If every option is refused as ambiguous or relaxing, record it and do 7.1 against the NY
    `AIDE_CERTIFICATION` rule instead.

**3. Offer accepted → SMS invite → intake, as a caregiver (B)**
3.1 Coordinator `/caregivers/new`: Maria Santos, +12125550192, NY, HHA, PRIVATE_PAY, SMS consent → verify:
    redirected to the record; B is on `/pipeline` under "Invited (n)".
3.2 Worker sends the invite → `/dev/outbox` shows one message to +12125550192 whose link's origin is
    exactly `http://localhost:3310` and path `/r/invite/<43-char token>` (the master's APP_URL finding).
3.3 In B's 375px context, open that link as given (not `/verify`), and continue only by clicking what each
    page offers: phone entry → code (read from `/dev/outbox`, newest to that number) → wherever the product
    lands. Record every URL and `<h1>` on the way. → verify (`expect.soft`, with an annotation): B reaches
    `/intake` without typing a URL. If not, annotate the page where a caregiver would have to guess, then
    navigate on and continue (finding for REVIEW; OPEN-QUESTIONS **262** if it needs a product decision
    beyond OQ-242). Also record: does the texted code arrive only via a second SMS, and is the invite
    consumed (stage INTAKE on `/pipeline`)?
3.4 Intake, each step as rendered: identity (DOB 1980-04-12), **Contact section (T-048)** with an email
    and address, home-care profile / certifications (HHA), work history with ≥2 references at +1212555017x,
    medical and EEOC sections, FCRA disclosure where it appears → verify: each step saves, the
    progress indicator advances, the final step reaches `/documents` / `/sign` as the product routes.

**4. Signing (T-064, worker needed)**
4.1 B on `/sign`: "preparing" → (worker) → ready; the signing link is followed via `devUrl()`; press
    "Sign all N documents" → webhook line "delivered: HTTP 200"; back on `/sign` → verify: signed state;
    `/pipeline` stage has advanced past paperwork.
4.2 Same for A (sign in at `/verify` with +12125550181 → code from outbox → continue her intake, add
    references +12125550173/74, sign) and for C (sign in, continue intake, sign).

**5. Uploads, extraction drain, queue (T-070/071/074, T-121, T-123)**
5.1 Worker has drained A's seeded extract jobs → A's HHA certificate and TB result are accepted
    automatically (no "Needs a decision" row for them).
5.2 B uploads, at 375px through `/documents/[instanceId]`: `hha-certificate.pdf` (DOB mismatch → exception),
    `ny-drivers-license.pdf`, and for every other open upload request a non-fixture PDF → verify: `/queue`
    headings "Needs a decision (n)", "Waiting on the caregiver (n)", "Automatic review stopped (n)",
    "E-signature stopped (n)" with n matching the rows.
5.3 Accept: open the dialog aria-label "Decide <requirement> for Maria Santos" (scoped to B's row by
    caregiver link href) → accept → row leaves.
5.4 Reject one of B's documents → row moves to "Waiting on the caregiver (n)"; worker drains the notice →
    `/dev/outbox` has a notice to +12125550192; B re-uploads; accept.
5.5 Waive one of B's requirements via dialog aria-label "Waive <requirement> for Maria Santos" with a reason
    → row leaves; clearance shows it waived.
5.6 Accept every remaining B and A exception → verify: `/pipeline` shows B (then A) under "Verification (n)"
    after the last accept (T-123).
5.7 Retry an envelope: for C, rename one of C's unsigned generated PDFs under `.e2e/storage/<agency>/<C>/generated/`
    before C's envelope is sent (between intake finish and `/sign`), wait for "E-signature stopped (n)" to
    list C (≤ 3 min), restore the file, press Retry → C's `/sign` becomes signable. This is harness fault
    injection on e2e storage only. If the send job never goes DEAD inside 3 minutes, record the step
    unverified with the observed job state; do not change product code to force it.
5.8 `/sample` (coordinator): `<h2>` "Week of …: n of m accepted", table caption "Sampled documents",
    A's auto-accepted document listed (or n/m = 0 of 0 with a reason recorded if sampling did not pick it).
5.9 Supervisor: `/queue` and `/sample` → 404.

**6. Verification (T-081, T-081b, T-082, T-082b, T-083)**
6.1 Coordinator `/checks`: order the background check for A, B, C (FCRA signed in step 4; an unsigned one
    shows "Waiting for signed FCRA disclosure" with no "Order check") → worker → dev
    `/dev/background-check`: A → CLEAR; B → CONSIDER; C → CONSIDER.
6.2 B's CONSIDER: "Clear" on `/checks` → B's background-check requirement SATISFIED on `/clearance/[B]`.
6.3 C's CONSIDER: "Fail" → C stays listed on `/checks` (checked again in 8.2).
6.4 A's background-check requirement SATISFIED on `/clearance/[A]` before any sign-off.
6.5 References: "Send request" for each of A's and B's two references → worker → read each
    `/r/reference/<token>` from `/dev/outbox` → open in a fresh (unauthenticated) context: A's two and one of
    B's answer Yes/Yes; B's other answers No → B's reference check "in review" on `/checks`; coordinator
    presses Satisfy (T-082b) → SATISFIED.
6.6 Health screenings (T-083): as coordinator, `/clearance/[A]` shows physical, TB, immunisation "In review"
    and **no** "Record result" button; as supervisor, "Record result" PASS for each of A's and B's three →
    verify: each SATISFIED, and A and B leave Document review on `/pipeline`.

**7. Certification role change (T-036) — caregiver C**
7.1 Before C finishes intake (do this in step 4.2 before signing): on the intake certifications step change
    C's certification so the role changes; the rule from 2.1 appears/disappears in C's `/documents` list;
    one requirement C had already started (uploaded) stays with its original rule — verify through
    `/caregivers/[C]` / `/clearance/[C]` requirement names. (C's withdrawal is 8.2, after 6.3's failed check.)

**8. Clearance, sign-off, sync, Active (T-100, T-101, T-111, T-112, T-113, T-115)**
8.1 Coordinator opens `/caregivers/[A]/alayacare` preview (renders); `/clearance/[B]` shows the alert
    "This agency has not synced to AlayaCare yet" with the preview link; supervisor sees the sentence
    and no link.
8.2 Withdraw C on `/caregivers/[C]` (T-138 control; confirm dialog) → C leaves `/checks` (the failed
    check leaves the list only on withdrawal, ADR-134) and shows under "Withdrawn" on `/pipeline`.
8.3 Sign-off A (supervisor, 1280): `/clearance/[A]` has heading "Sign-off", button "Sign off Maria Santos";
    keyboard only — Tab to the button, Enter opens dialog "Sign off clearance" (role=dialog, accessible name),
    focus is inside it, Tab cycles within it, Escape closes and focus returns to the button; reopen and
    confirm. Coordinator context sees no Sign-off section. Then repeat the open/close at 375px and
    screenshot (dialog fits, no horizontal scroll: `scrollWidth <= clientWidth`).
8.4 Worker + mock: A's sync → `pg`: an `AlayaCareSync` row for A with status `SYNCED`; `/pipeline`
    shows A under "Active (n)"; mock `GET /<agencyId>/employees/<externalId>/documents` (retry 429/503)
    lists allowlisted `<templateKey>.pdf` names (T-115: at least `OFFER_LETTER.pdf`) and the HHA evidence,
    and no `W_4.pdf`, `NY_IT_2104.pdf`, `I9_SECTION_1.pdf`, `DIRECT_DEPOSIT_ELECTION.pdf`.
8.5 `/clearance/[B]` no longer shows the preview alert (agency's first SYNCED happened).
8.6 Sign-off B → worker → `/sync` lists B (REJECTED as duplicate of emp-0001, per T-113); on
    `/sync/[B]` "Link to AlayaCare employee emp-0001" → rerun stops as CONFLICT (email, phone) → choose one
    THEIRS and one OURS → Retry → worker → `pg`: B's latest `AlayaCareSync` `SYNCED`; B under "Active (n)";
    `/sync` no longer lists B.

**9. Caregiver self-view (T-131)**
9.1 A signs in fresh (new context) at `/verify` with the code from `/dev/outbox` → `/record`: SSN shown as
    ending digits only (`6789`, never `123-45-6789`), EEOC shown only as submitted (no answers), nav links
    present and each resolves (no 404).

**10. Pipeline layout (T-120)**
10.1 `/pipeline` at 1280 and at 375: for each non-empty stage, `<h2>` "{Stage} (n)", table caption
     "{Stage} caregivers", columns "Days in stage" and "Current blocker"; no horizontal page scroll at 375
     (tables may scroll inside their own container); screenshots saved to `.e2e/results`.
10.2 Keyboard: from the top, Tab order reaches the nav, then the rows' links in document order; the focused
     element has a visible focus indicator (computed `outline-style` not `none` or a box-shadow ring).

**11. Smoke of the new staff pages**
11.1 `/training` (coordinator) renders its heading; `/reports/metrics` (admin) renders with metrics listed
     and "not measured" where ADR-158 says; `/admin/requirements` done in 2.1.

## Out of scope

- No product feature work. **Fix line:** a product bug the run finds may be fixed in this task only if it
  is ≤ ~20 changed lines in one file inside the feature that failed, starts with a failing unit/db test,
  and needs no schema, policy, registry or ADR change. Everything else is reported (with the step, URL
  and screenshot) and becomes a follow-up task. Never weaken an assertion to make the run pass.
- No CI wiring, no `npm run test` inclusion, no vitest project for `e2e/`.
- No new dev pages, no test-only routes, no product hooks for the harness. Fault injection is limited to
  renaming a file under `.e2e/storage` (5.7).
- No `webServer`, no `npx playwright install`, no Chromium download.
- Do not touch the dev database `credora`, port 3000, port 4010, `credora-postgres` or `.next/`.
- No screenshot-diff baselines; screenshots are evidence for REVIEW only.

## Success criteria

- [ ] Every quoted PRD bullet above is exercised by a passing step (or the failure is reported as a finding)
- [ ] `npm run e2e` passes end to end twice in a row (the second run proves the fresh-DB/storage reset)
- [ ] `npm run build` passes (and still writes to `.next` with `CREDORA_DIST_DIR` unset)
- [ ] `vitest related src/lib/env.ts` passes
- [ ] `npm run lint` passes (e2e files included; `.e2e/**` ignored)
- [ ] `git status` after a run shows no change outside `writes:` (in particular tsconfig.json is stable)
- [ ] The dev DB `credora` is untouched (row counts before/after identical — check `Caregiver` count)

## Tests to write

- `e2e/happy-path.spec.ts` — steps 0–11 above, each item a `test.step` with its assertion — PRD § Target
  workflow end to end; risk: the notes' unverified browser behaviours.
- `src/lib/env.test.ts` — (a) `NODE_ENV=production` without `APP_URL` fails with a message naming APP_URL;
  (b) outside production it still defaults to `http://localhost:3000` (existing test kept) — risk: texted
  links built on a default origin in production (T-052 note).

No test for `e2e/support/*` helpers; the run exercises them.

## Handoff to the checker — unverified by any driver (REVIEW.md must list these explicitly)

- Real SMS delivery to a handset (carrier, sender id, link previews); real email delivery.
- A real e-sign vendor's signing experience and legal validity (the mock page was used via a harness URL rewrite).
- Real background-check vendor timing and webhooks; real AlayaCare API behaviour (custom fields, auth, rate limits beyond the mock's schedule).
- The LLM judge (the mock judge ran; `JUDGE_ADAPTER=claude` never set).
- Physical-device rendering and touch (Edge device emulation at 375px only); screen-reader announcement
  (only roles, names and focus were asserted); visual quality of focus rings beyond "present".
- Training import by the scheduled platform file (smoke only).
- Whether the invite → code → intake walk is guessable (3.3's recorded answer, with the URLs/headings list).

## Risks and open questions

1. **Selectors from memory are wrong.** Read the named page before writing each step; prefer roles and
   accessible names quoted in the notes; locate caregivers by id-bearing hrefs.
2. **`next build` with a custom distDir may add `.e2e/next/types/**/*.ts` to `tsconfig.json` include.**
   With `.e2e` in `exclude`, those lines are inert; commit them once so later runs leave tsconfig clean,
   and confirm `npm run build` (default `.next`) is unaffected. If Next instead rewrites `exclude`, stop and report.
3. **Worker timing.** Every worker-dependent wait polls with reload; backoff is 10 s × 2^n (cap 10 min), so a
   step waiting on a retried job may need minutes — budget, do not sleep.
4. **Mock fault schedule** (429/503 every N requests) also hits the spec's own GETs — retry them.
5. **TOTP one-use per 30 s step per user** — per-user last-step tracking; recovery codes for repeats.
6. **Prisma `migrate deploy` takes a global advisory lock** — a concurrent agent's migration can block
   setup; wait, do not kill anything that is not ours.
7. **Step 5.7 may be unreachable** without product hooks; that is an acceptable "unverified" outcome.
8. **Two same-name "Maria Santos" caregivers plus the seeded one** — dialog aria-labels are not unique;
   scope every dialog trigger to the row containing the caregiver's id.
9. OPEN-QUESTIONS **262–264** are reserved for decisions the run surfaces (262: invite → intake continuity
   if it goes beyond OQ-242). Do not invent product answers; log them with the default in force.
