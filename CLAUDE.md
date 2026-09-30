# Credora — Agent Router

Credential tracking and onboarding for New York home care agencies. Takes a caregiver
from accepted offer to cleared-to-work with no manual re-keying. First customer: Alvita Care.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Postgres 16 (Docker) · Prisma

---

## READ THIS FIRST — how to work in this repo

Work runs through the superpowers skills. Start at `docs/PROGRESS.md`: it says where the
project stands and which plan is current.

1. **Design** with `superpowers:brainstorming`, in the main session with the user. The spec goes
   in `docs/superpowers/specs/`. A decision that changes a rule in `docs/context/` (superseding
   an ADR, a new `AGENTIC-TASKS.md` entry) is also appended to `DECISIONS.md` as an ADR, and
   the context file is updated to match.
2. **Plan** with `superpowers:writing-plans`, saved in `docs/superpowers/plans/`. Each task
   names the context files and `MODULES.md` rows its implementer needs, so nobody searches.
   Once the user approves it, commit the spec and plan, and put the plan's path under Current
   plan in `docs/PROGRESS.md`.
3. **Build** with `superpowers:subagent-driven-development`, on `main`. Implementers commit
   their own task; tasks run one at a time, so commits cannot collide.
4. **Finish.** Run the full test suite once and the final review. Then delete the plan file,
   record it under Finished plans in `docs/PROGRESS.md` (what changed, and the commit range
   where the plan can be recovered), and commit. Specs and ADRs are kept; plans are not.

**All work is committed directly on `main`.** No feature branches or worktrees: skip
`superpowers:using-git-worktrees` and `superpowers:finishing-a-development-branch`, and this
overrides the skills' "never implement on main" rule. Pushing to `origin` leaves the machine,
so ask first.

`superpowers:systematic-debugging`, `superpowers:verification-before-completion` and
`superpowers:receiving-code-review` apply everywhere.

Locate code through `docs/context/MODULES.md`, and add a row there when you create a directory.
Never read `docs/PRD.md` end to end; read the section you need.

### Superpowers rules that this repo overrides

This file takes precedence over the skills (`using-superpowers` § User Instructions).

- **TDD covers only what `CONVENTIONS.md` § Tests keeps:** pure rules in `src/domain/` and
  agent evals. Pages, actions, use-case wiring and adapters get no tests; `npm run build` and
  `npm run lint` verify them. This overrides TDD's "no production code without a failing test".
- **No full-suite runs inside a task.** Where a skill says to run the full test suite, run
  `npx vitest related <changed files> --run`. The full suite runs once, when a plan is finished.
- **Reviewers delete.** When dispatching a task or final reviewer, put § Hard rules and this
  list in its global constraints, and have the fixes applied: dead code and unused exports;
  abstraction with one caller; `try/catch` that only rethrows or logs; branches guarding states
  that cannot occur; comments that restate the code; scaffolding, console logs and
  commented-out code; options nobody passes; tests that `CONVENTIONS.md` § Tests does not keep.

### Keep going once a plan is approved

Run the plan to its end without stopping between tasks or asking permission for the next one.
Progress reports are for information, not for approval.

**Stop and ask only when:**

- a decision is genuinely the product owner's and proceeding under any assumption would be
  unsafe or would make the work useless if wrong — otherwise pick the defensible default,
  isolate it to one place, and log it in `docs/OPEN-QUESTIONS.md`;
- a task cannot be finished without a scope change the user has not authorised;
- an action is destructive or outward-facing (force-push, deleting data, anything leaving the
  machine).

**A user instruction to stop overrides this.** Finish the current task properly (reviewed and
committed), then stop and do not start the next one. Resume only when asked.

## Router — where things live

| I need to know… | Read |
| --- | --- |
| What we are building, and why | `docs/PRD.md` (cite a section; never read it whole) |
| Where the project stands, the current plan, what is next | `docs/PROGRESS.md` |
| The current design and plan | `docs/superpowers/specs/`, `docs/superpowers/plans/` |
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
no comments restating the code. Reviewers delete these.

**Tests.** Few and fast: unit tests for pure rules in `src/domain/` and agent evals on the mock
model, nothing else. Each task runs only the tests related to its changes; the full suite runs
once per plan, when it is finished. Every task is also verified by `npm run build` and
`npm run lint`. See `CONVENTIONS.md` § Tests.

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
```

@AGENTS.md
