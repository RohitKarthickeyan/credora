# Credora

Credential tracking and onboarding for New York home care agencies. It takes a caregiver from
accepted offer to cleared-to-work, with no manual re-keying. First customer: Alvita Care.

A caregiver moves through one tracked pipeline:

```
Offer accepted → Email invite → Mobile intake → Forms + e-sign → Document review
  → Background check, fingerprints, references, health, training
  → Supervisor clearance → Sync to AlayaCare → Active
```

- **Caregivers** do everything on their phone and type each fact once. Credora fills the
  official forms (W-4, IT-2104, I-9 §1, LS 54) and the agency's documents, and sends them as
  one e-sign envelope.
- **Uploaded IDs and certificates** are checked by rule-based identity matching, plus an AI
  judge for home-care records. A document is auto-accepted only when every check passes;
  anything else goes to a staff exception queue.
- **Supervisors** clear a caregiver from one screen that shows every requirement, its evidence
  and its status. Credora then creates or updates the caregiver in AlayaCare, including
  credential expiry dates.

It is a rules engine, not an AI product. The only runtime LLM use is the document judge
(`docs/context/AGENTIC-TASKS.md`).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Postgres 16 (Docker) ·
Prisma 7

## Running locally

Requirements: Node 20+ and Docker.

```bash
npm install
cp .env.example .env    # then replace FIELD_ENCRYPTION_KEY and SESSION_SECRET (see comments)
npm run db:up           # Postgres 16 on port 5433
npm run db:migrate
npm run db:seed         # Alvita agency, staff users, NY requirement templates, demo caregivers
```

Then run these side by side:

```bash
npm run dev             # web app on http://localhost:3000
npm run worker          # job worker: ticks schedules and drains the job queue
npm run mock:alayacare  # optional: the AlayaCare mock server, needed for the sync step
```

Without the worker, no text is sent, `/sign` stays on "preparing", and uploaded documents are
never extracted.

### Demo accounts

Every staff account uses the password `alvita-demo-2026`. Alvita requires MFA, so the first
sign-in asks you to enrol an authenticator app.

| Role | Email | Main screens |
| --- | --- | --- |
| Coordinator | `coordinator@alvita.test` | `/pipeline`, `/queue`, `/checks` |
| Supervisor | `supervisor@alvita.test` | clearance and sign-off |
| Agency admin | `admin@alvita.test` | users, requirement templates, AlayaCare mapping, reports |
| Implementation | `implementation@alvita.test` | requirement templates |

Demo caregivers sign in by email at `/verify` (the code arrives in `/dev/outbox`):

- Maria Santos: `maria.santos@example.com`
- Grace Mensah: `grace.mensah@example.com`
- Andre Joseph: `andre.joseph@example.com`

Every email the mock sends appears at **`/dev/outbox`**, including sign-in codes, invite links
and reference forms. `/dev/background-check` advances the mock background-check vendor. Emailed
links are built from `APP_URL`, so keep it equal to the port you serve on.

To start over from a clean demo: `npx prisma migrate reset`, delete `./storage`, then
`npm run db:seed`.

## Integrations

Every outside service sits behind a port in `src/integrations/ports`. The adapter in force is
chosen by an environment variable (`<PORT>_ADAPTER`). An unknown adapter name is caught at
startup, and under `next start` every request then fails with an error until it is fixed.

| Service | Today | Going live needs |
| --- | --- | --- |
| Email | mock + `/dev/outbox` | an email provider adapter (e.g. SendGrid). Credora sends no text messages (ADR-161) |
| E-signature | mock envelopes + local signing page | a vendor adapter (e.g. DocuSign, Dropbox Sign) |
| OCR extraction | fixture-driven mock | a vendor adapter (e.g. Textract, Azure Document Intelligence) |
| Background check | mock vendor state machine | a vendor adapter (e.g. Checkr), FCRA review |
| AI document judge | mock by default; **Claude adapter exists** (`JUDGE_ADAPTER=claude`) | a BAA with zero data retention before real documents |
| AlayaCare | **HTTP adapter exists**, built against `mock-servers/alayacare`, which follows AlayaCare's published employee API; CSV export adapter | per-agency API keys, then verification against the real API |
| Training records | CSV and API fixture mock | Alvita's export format or API |
| File storage | local disk (`./storage`) | an S3 or Azure Blob adapter |

Fingerprint (CHRC) results and the NY Home Care Registry lookup are manual staff tasks by
design. NY offers no API for either.

## Running in production

Run the web process with `npm run build && npm run start`. Run `npm run worker` as a separate,
always-on process under the platform's process manager: restart it on exit, and send SIGTERM
for a graceful stop (it finishes the jobs in hand, then exits). More than one worker is safe:
jobs are claimed with `SKIP LOCKED`, and every worker has a distinct id.

## Checks

```bash
npm run build    # production build; also the typecheck gate
npm run lint     # includes the layering rules
```

There is no test suite.

## Project layout

```
src/app          UI and routes: staff app, caregiver flow, dev tools
src/server       use cases: auth, intake, forms, review, verification, clearance, sync, jobs
src/domain       pure rules: requirements engine, matching, pipeline, forms. No I/O
src/db           Prisma client, repositories, encryption, audit log, restricted stores
src/integrations ports, adapters, registry, job queue
prisma           schema (core, medical, eeoc schemas), migrations, seed
```

`src/domain` imports nothing from `app`, `server`, Prisma or Next. Medical and EEOC data live
in separate Postgres schemas behind audited accessors. SSN, bank and work-authorisation fields
are encrypted with AES-256-GCM.

## Documentation

| Topic | File |
| --- | --- |
| Product requirements | `docs/PRD.md` |
| Which directory owns a feature | `docs/context/MODULES.md` |
| Architecture and layering | `docs/context/ARCHITECTURE.md` |
| Data model and restricted stores | `docs/context/DATA-MODEL.md` |
| Security, RBAC, encryption, audit | `docs/context/SECURITY.md` |
| Integrations and env vars | `docs/context/INTEGRATIONS.md` |
| Decisions (ADR log) | `docs/context/DECISIONS.md` |
| Questions for the product owner, each with its default in force | `docs/OPEN-QUESTIONS.md` |
