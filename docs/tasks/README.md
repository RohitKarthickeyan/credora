# Task folders

One folder per task: `T-0XX-<slug>/`, containing

```
PLAN.md     written by the planner, read by the implementor.  Template: ../_TEMPLATE.md
REVIEW.md   written by the checker after implementation.
```

A finished task's folder is deleted once the task is committed.

## The three-agent cycle

Each task runs planner → implementor → checker. They share nothing but these two files and
the context manifest, which is the point: no agent inherits another's context window.

### Planner

**Given:** the task id, `docs/PRD.md § <the one cited section>`, and the context files listed
for its phase.
**Produces:** `PLAN.md` from `_TEMPLATE.md`.
**The one thing that matters:** the `reads:` manifest. It must be complete enough that the
implementor never runs a search, and tight enough that it does not become "read everything".
If the planner cannot name the files, the design is not finished.

### Implementor

**Given:** `PLAN.md` and nothing else. Reads exactly what `reads:` lists.
**Produces:** the code in `writes:`.
**Rules:** does not expand scope; does not refactor adjacent code; if the plan is wrong,
stops and says so rather than improvising.

### Checker

**Given:** `PLAN.md`, the diff, and `CONVENTIONS.md`.
**Does:** runs build and lint. Verifies each quoted PRD bullet. Then *deletes*: dead code,
unused exports, speculative abstraction, `try/catch` that only rethrows, defensive branches
for impossible states, comments restating the code, leftover scaffolding.
**Produces:** `REVIEW.md` — what it verified, what it removed, what it could not fix and why.
Sets the task status with `node scripts/dag.mjs set T-0XX done`.

The checker's deletions are not optional politeness. Unchecked, each task leaves a little
residue, and eighty tasks of residue is an unmaintainable codebase.

## REVIEW.md shape

```markdown
# T-0XX review

## Verified
- [x] <quoted PRD bullet> — <how it was verified>
- build / lint: <result>

## Removed
- <file:line> — <what and why>

## Shared files touched
- <path> — <what was appended>   (see MODULES.md § Files that many tasks touch)

## Deviations from the plan
- <what differed and why> — or "none"

## Follow-ups
- <anything deliberately left, with a task id> — or "none"
```
