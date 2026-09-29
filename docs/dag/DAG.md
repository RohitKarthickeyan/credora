# Task DAG

**Revision 2** — 80 tasks, 16 dependency waves. `docs/dag/dag.json` is the machine-readable
source of truth; this file explains the shape of it. `docs/PROGRESS.md` is generated from it
— never edited.

Revision 1 (67 tasks) was reviewed against the PRD before any code was written; the review
and the fourteen tasks it added are in `docs/dag/REVIEW.md`. Read that before questioning an
edge here — it probably explains why.

```bash
node scripts/dag.mjs validate   # cycles, dangling deps, bad statuses
node scripts/dag.mjs ready      # what can be started right now, in parallel
node scripts/dag.mjs waves      # the full parallel schedule
node scripts/dag.mjs show T-074 # one task, its deps, and what it unblocks
node scripts/dag.mjs set T-001 done
```

## Shape of the graph

Abridged — every node is in `dag.json`; this shows the load-bearing edges.

```mermaid
flowchart TD
  T001[T-001 scaffold] --> T002[T-002 postgres+prisma]
  T001 --> T003[T-003 ui primitives]
  T001 --> T004[T-004 zod primitives]
  T002 --> T010[(T-010 core schema)]
  T004 --> T010

  subgraph C[Phase 1 - core platform]
    T010 --> T012[T-012 encryption]
    T010 --> T013[T-013 audit]
    T010 --> T015[T-015 pipeline machine]
    T010 --> T016[T-016 job queue]
    T010 --> T017[T-017 storage port]
    T013 --> T011[T-011 restricted stores]
    T012 --> T014[T-014 rbac policy]
    T013 --> T014
    T016 --> T018[T-018 scheduler]
    T014 --> T019[T-019 masking UI]
  end

  subgraph R[Phase 4 - requirements engine, the spine]
    T010 --> T030[T-030 templates]
    T030 --> T031[T-031 layered resolver]
    T031 --> T032[(T-032 instances)]
    T031 --> T033[T-033 NY library]
  end
  T015 --> T032

  subgraph I[Phase 3 - integrations, one wave]
    T016 --> T050[(T-050 ports + registry)]
    T017 --> T050
    T050 --> T051[T-051 messaging]
    T050 --> T052[T-052 e-sign]
    T050 --> T053[T-053 extraction]
    T050 --> T054[T-054 judge AGENTIC]
    T050 --> T055[T-055 bg check]
    T050 --> T056[T-056 alayacare mock]
    T050 --> T057[T-057 training]
    T052 --> T058[T-058 webhooks]
  end

  T014 --> T020[T-020 staff auth]
  T051 --> T021[T-021 caregiver auth]
  T020 --> T023[T-023 MFA]

  T032 --> T040[T-040 form engine]
  T040 --> T047[T-047 field binding]
  T047 --> T046[T-046 identity/payroll sections]
  T047 --> T043[T-043 homecare profile]
  T043 --> T036[T-036 role axis]
  T021 --> T044[T-044 invite flow]

  T032 --> T060[T-060 document set]
  T060 --> T061[T-061 pdf filling]
  T046 --> T061
  T060 --> T062[T-062 agency + attestation docs]
  T061 --> T064[T-064 envelope]
  T062 --> T064
  T052 --> T064
  T017 --> T064

  T021 --> T070[T-070 upload]
  T017 --> T070
  T070 --> T071[T-071 extraction pipeline]
  T053 --> T071
  T071 --> T072[T-072 identity matching]
  T071 --> T073[T-073 judge orchestration]
  T054 --> T073
  T077[T-077 issuer allowlist] --> T073
  T072 --> T074{{T-074 auto-accept}}
  T073 --> T074

  T074 --> T100[T-100 clearance view]
  T064 --> T100
  T100 --> T101[T-101 sign-off]
  T074 --> T102[T-102 credentials]
  T074 --> T121[T-121 exception queue]
  T121 --> T123[T-123 exception resolution]

  T056 --> T110[T-110 field mapping]
  T110 --> T111[T-111 sync profiles]
  T101 --> T111
  T111 --> T115[T-115 sync credentials + docs]
  T102 --> T115
  T064 --> T115
  T115 --> T112[T-112 preview]
  T111 --> T113[T-113 conflicts]
  T115 --> T114[T-114 export fallback]

  T115 --> T133[[T-133 e2e happy path]]
  T123 --> T133
  T132[T-132 seed] --> T133
```

## Why the graph is shaped this way

**T-010 and T-050 are the two hinges.** Almost everything descends from the core schema or
from the port registry. They are the only two tasks worth serialising around.

**The requirements engine (T-030 to T-032) gates five modules.** Intake asks only for fields a
requirement needs; the document set contains only documents a requirement needs; clearance is
a fold over instances; the sync writes credentials derived from them. Building intake first
would mean building it twice.

**T-017 exists so that no byte is written before there is a place to put it.** Generated PDFs,
signed PDFs, camera uploads, documents pushed to AlayaCare, and audited deletion are five
consumers across five waves. Without one owner in phase 1 they become five conventions and a
reconciliation in wave 14. The review that added it is in `REVIEW.md`.

**T-074 (auto-accept) is the narrowest waist.** It is the one place where extraction, identity
matching, the judge, and the requirement model meet, and six later tasks wait on it. Wave 10
is nearly empty for this reason. It is pure, small, and heavily tested.

**Integrations fan out wide (wave 5, 12 tasks).** Every port is independent of every other, so
all eight adapters can be built concurrently once the registry exists. T-050 pre-declares
every port slot and env var precisely so those twelve concurrent tasks do not collide on
`registry.ts` and `env.ts`.

**The tail (waves 12 to 15) is necessarily serial.** Sign-off must precede sync; profile sync
must precede credential sync; that must precede preview, the export fallback, and the
end-to-end test. No amount of parallelism removes that ordering — it is the product's actual
causality.

## Critical path

Computed, not asserted — the script derives it from the graph:

```
T-001 → T-002 → T-010 → T-016 → T-050 → T-051 → T-021 → T-070 → T-071
      → T-072 → T-074 → T-100 → T-101 → T-111 → T-115 → T-112
```

Sixteen tasks. Note what is *on* it: the messaging adapter, caregiver auth, and document
upload. `T-071` waits on upload (`T-070`), not on the extraction adapter (`T-053`) — the
adapter lands five waves earlier and has slack. Protect the chain above; everything else has
room.

The two agentic tasks (`T-054`, `T-073`) are deliberately *off* the critical path, so a
problem with the judge cannot stall the pipeline.

## The two agentic tasks

`T-054` (judge adapter) and `T-073` (judge orchestration) are the only tasks permitted to
involve an LLM at runtime, and both default to a deterministic mock. See
`docs/context/AGENTIC-TASKS.md` for the justification and the rejected alternatives.

## Deliberately deferred

Not in this graph, per the PRD's non-goals: scheduling, recruiting, training content,
continuous post-hire compliance monitoring, cross-agency records, states other than New York,
languages other than English, payroll processing, native apps.

`T-090` (training hours) and `T-114` (AlayaCare export fallback) are the only P1 tasks;
everything else is P0. Both are scheduled last regardless of what the wave computation says.
