---
task: T-0XX
slug: <slug>
title: <title>
prd: "<exact PRD section heading this task satisfies>"
reads:
  # THE COMPLETE required reading for the implementor. Nothing else should be opened.
  # Be specific — a path plus, where useful, the symbol that matters.
  - docs/context/CONVENTIONS.md
  - docs/context/NEXTJS-16.md        # only if this task writes a page/route/action
  - <other context files this task actually needs>
  - <source files this task will read or extend, with the symbols that matter>
writes:
  # Every file this task creates or modifies. The checker verifies nothing else changed.
  - <path>
depends_on: [T-0XX]
---

# T-0XX — <title>

## What this task must produce

One paragraph. The observable outcome, in the product's vocabulary, not in implementation
terms. If you cannot state it without naming a file, the task is not understood yet.

## PRD requirements covered

Quote the specific bullets from `docs/PRD.md § <section>`. Quote them; do not paraphrase.
Anything not quoted here is out of scope for this task.

- > "..."
- > "..."

## Design

The approach, and the reasoning that is not obvious from the code. Include:

- Public surface: the exact signatures other tasks will import.
- Data shape: models added or changed, with field names.
- Where each piece lives, and why that layer (`ARCHITECTURE.md`).
- Invariants that must hold afterwards.

Do not write the implementation here. Write what an implementor cannot infer.

## Steps

1. <step> → verify: <the check that proves it>
2. <step> → verify: <check>
3. <step> → verify: <check>

## Out of scope

Explicitly list what a reasonable implementor might add and must not. This is where scope
creep is prevented.

## Success criteria

- [ ] Every quoted PRD bullet above is satisfied
- [ ] `npm run build` passes
- [ ] `npm run lint` passes, layering rule included
- [ ] No file outside `writes:` was modified

## Risks and open questions

Anything the implementor should raise rather than guess at.
