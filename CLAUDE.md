# Credora — Agent Router

Credential tracking and onboarding for New York home care agencies. Takes a caregiver
from accepted offer to cleared-to-work with no manual re-keying. First customer: Alvita Care.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Postgres 16 (Docker) · Prisma

---

## READ THIS FIRST — how to work in this repo

This repo is organised so that **no agent ever has to search the codebase to find its context.**
Every task carries a manifest of exactly what to read. Read your manifest; read nothing else.

1. Find your task ID (`T-###`) in `docs/PROGRESS.md`.
2. Open `docs/tasks/T-###-<slug>/PLAN.md`. Its frontmatter `reads:` list is your complete
   required reading. It is authoritative — if it is wrong, fix it, don't compensate by grepping.
3. Write code. `docs/PROGRESS.md` is generated — never edit it by hand. Record status
   with `node scripts/dag.mjs set T-### <status>`.
4. Never read `docs/PRD.md` end to end. Read the one section your task cites.

If you are about to run a broad `grep` or `Glob` across `src/`, stop — that means a manifest
is missing information. Fix the manifest instead.

---

## The orchestrator runs the build without being prompted

Orchestration has three tiers: the top-level session is the **master**, and it delegates each
batch of tasks (a phase or a set of nodes) to **one batch-orchestrator subagent** at a time, which
runs that batch's planners, implementors and checkers. See `ORCHESTRATION.md` § Three tiers.

The orchestrator does not stop between tasks, waves, or phases, and does not ask permission to
start the next one. When a checker sets a task `done`, the orchestrator commits it, recomputes
the frontier with `node scripts/dag.mjs ready`, and immediately starts the next planners and
implementors. It keeps doing that until `ready` is empty and `status` shows every task done.

**Stop and ask only when:**

- a decision is genuinely the product owner's and proceeding under any assumption would be
  unsafe or would make the work useless if wrong — otherwise pick the defensible default,
  isolate it to one place, and log it in `docs/OPEN-QUESTIONS.md`;
- a task is `blocked` and recovering it needs a scope change the user has not authorised;
- an action is destructive or outward-facing (force-push, deleting data, anything leaving the
  machine).

Progress reports are for information, not for approval. Never end a turn waiting for a "yes"
that the build does not actually need.

**A user instruction to stop overrides this.** If the user says to stop after the current task,
finish the task properly — a task is not finished until its checker has run and it is committed
— then stop, and do not start the next one. Resume only when asked.

## Router — where things live

| I need to know… | Read |
| --- | --- |
| What we are building, and why | `docs/PRD.md` (cite a section; never read it whole) |
| Current status, what is done, what is next | `docs/PROGRESS.md` |
| The task graph and what unblocks what | `docs/dag/DAG.md`, machine-readable `docs/dag/dag.json` |
| **Which directory owns a feature** | `docs/context/MODULES.md` ← start here to locate code |
| System layering, directory map, what may import what | `docs/context/ARCHITECTURE.md` |
| Canonical caregiver record, storage tiers, restricted stores | `docs/context/DATA-MODEL.md` |
| Domain vocabulary (HHA, CHRC, I-9, clearance, requirement instance) | `docs/context/DOMAIN.md` |
| Code style, naming, testing, error-handling rules | `docs/context/CONVENTIONS.md` |
| External services, port interfaces, mock adapters, env vars | `docs/context/INTEGRATIONS.md` |
| **Next.js 16 breaking changes vs. what you remember** | `docs/context/NEXTJS-16.md` ← read before writing any route/page |
| Security, RBAC, encryption, audit rules | `docs/context/SECURITY.md` |
| Which tasks genuinely need an LLM at runtime, and why | `docs/context/AGENTIC-TASKS.md` |
| Why a past decision was made | `docs/context/DECISIONS.md` (append-only ADR log) |
| **Questions only a product owner can answer** | `docs/OPEN-QUESTIONS.md` — flagged, not invented; each names the default in force |
| How the build is run: planner → implementor → checker | `docs/context/ORCHESTRATION.md` |
| A specific task's plan | `docs/tasks/T-###-<slug>/PLAN.md` |
| A specific task's review outcome | `docs/tasks/T-###-<slug>/REVIEW.md` |

---

## Hard rules

**Determinism.** This product is a rules engine, not an AI product. Default to deterministic
code. An LLM call at runtime is allowed only for entries listed in
`docs/context/AGENTIC-TASKS.md`; adding a new one requires an ADR in `docs/context/DECISIONS.md`.

**Layering.** `src/app` (UI + routes) → `src/server` (use cases) → `src/domain` (pure rules).
`src/domain` imports nothing from `app`, `server`, Prisma, or Next. Integrations are reached
only through ports in `src/integrations/ports`. See `ARCHITECTURE.md`.

**Restricted data.** Medical and EEOC data live in separate Prisma schemas behind their own
access functions. Never join them into a caregiver query. See `DATA-MODEL.md`.

**Simplicity.** Minimum code that satisfies the cited PRD requirement. No speculative
abstraction, no configurability nobody asked for, no try/catch around impossible failures,
no comments restating the code. The checker agent deletes these.

**Tests.** There is no test suite (removed 2026-09-28 ahead of a rework). A task is verified
by `npm run build` and `npm run lint`.

---

## Commands

```bash
npm run dev            # Next dev server
npm run build          # production build (also the typecheck gate)
npm run lint           # ESLint
npm run db:up          # docker compose up postgres
npm run db:migrate     # prisma migrate dev
npm run db:seed        # seed Alvita agency + NY requirement templates
npm run worker         # job worker: ticks schedules, drains the queue (run beside dev)
npm run dag:ready      # list tasks whose dependencies are all done
npm run dag:status     # progress summary
```

@AGENTS.md
