# Conventions

## Code

- TypeScript strict. No `any`. No non-null `!` — narrow properly.
- Named exports. Default exports only where Next requires them (`page.tsx`, `layout.tsx`, `route.ts`).
- Files kebab-case; React components PascalCase named to match the file's primary export.
- Zod is the single source of validation truth. Types are `z.infer`red, never declared twice.
- Dates: store UTC, compare with `date-fns`. A credential expiry is a **date**, not an instant —
  treat it as such and never let a timezone shift an expiry by a day.
- Money and hours: integers (cents, minutes). Never floats.

## Comments

Write a comment only for something the code cannot say: a regulatory constraint, a
counter-intuitive rule, a deliberate deviation. Never restate the code. Never leave
`// TODO` without a task ID. Reviewers delete commentary.

Good: `// I-9 §2 is examined by a person; there is deliberately no auto-accept path.`
Bad: `// loop over the requirements`

## Error handling

- Do not `try/catch` unless you are doing something with the error other than rethrowing.
- Expected outcomes are return values, not exceptions. A requirement failing to be satisfied
  is a status, not a throw. Use a `Result`-shaped return where a caller must branch.
- Exceptions are for programmer error and genuinely exceptional I/O failure. Let them hit the
  boundary (`error.tsx`, route handler, queue worker) which logs once and reports once.
- Never swallow. Never `catch (e) { console.log(e) }`.

## Server / client boundary

- Server Components by default. `"use client"` only for genuine interactivity, as deep in
  the tree as possible.
- Mutations are Server Actions in `src/app/**/actions.ts`, marked `"use server"`. Every action:
  authenticate → authorize via `policy.ts` → validate with zod → call a use case → revalidate.
  Those four steps in that order, every time.
  The authorize step happens in the use case via `defineUseCase`; the action calls `runAsPrincipal`.
- Route handlers are for webhooks and file streaming only. Not for our own UI's data.
- **Read `NEXTJS-16.md` before writing any route, page, or action.** Next 16's async APIs and
  caching defaults differ from what you remember.

## Database

- Every repository function takes `agencyId` first. There is no unscoped query.
- Prisma is imported only in `src/db/`. Use cases call repositories.
- Multi-step writes are `runInAuditedTransaction` from `@/db/audit`, which opens a
  `prisma.$transaction` or joins the one already open. The audit entry is written in the same
  transaction as the thing it audits — `writeAuditEntry` accepts only that transaction's
  client, so it cannot be written outside it. The actor comes from `runWithAuditContext`,
  established once at the boundary.
- Migrations are checked in. Never edit an applied migration.

## UI

- Tailwind v4, tokens in `globals.css` via `@theme`. No arbitrary colour values in components.
- The caregiver flow is phone-first: design at 375px, then widen. Touch targets ≥ 44px.
  One question group per screen. Never a desktop form squeezed onto a phone — that drop-off
  is the problem we are solving.
- The staff app is desktop-first, dense, keyboard-navigable.
- Primitives in `src/ui/` know nothing about caregivers.

## Tests

The previous suite outgrew the code it tested (48k test lines against 36k source; 25 minutes for
the database tests) and was removed on 2026-09-28. These rules keep its replacement small and fast.

- **Two kinds only.** Unit tests for pure rules in `src/domain/`, as `*.test.ts` beside the file,
  and agent evals: scripted caregiver conversations run against the mock model. No database, UI
  or route tests. `npm run build` and `npm run lint` cover everything else.
- **Test a rule once**, in `src/domain/`. Never prove it again through a use case.
- **Never test** the framework, a schema's shape, exact copy strings, or that a function exists.
- **Write freely, keep few.** Tests written while building (TDD) are scaffolding. Before a task is
  done, cut them to one test per rule with consequences (a state-machine transition, an expiry,
  an identity match, clearance) plus one per real bug fixed. Delete the rest.
- **Run only what you touched.** A task runs `npx vitest related <changed files> --run`. The full
  suite runs once per branch, when it is finished.
- Vitest is not installed. The first task that writes a test adds it: `vitest` as a
  devDependency, a `test` script, and one project with no database setup.

## Definition of done for a task

1. The PRD requirement it cites is satisfied.
2. `npm run build` passes (this is the typecheck gate).
3. `npm run lint` passes.
4. Any tests follow § Tests, and `npx vitest related` passes for the changed files.
5. No dead code, no unused exports, no commented-out code, no speculative abstraction.
6. Reviewed, with the reviewer's deletions applied, and committed.
