# DAG review — revision 1 → 2

An independent agent reviewed revision 1 (67 tasks) against the PRD before any code was
written. This records what it found and what was done about it. Revision 2 has 80 tasks.

## Verdict it gave

Structurally sound — the requirements engine correctly identified as the spine, ports
correctly hoisted above consumers, `T-074` correctly the waist — but **not safe to build
from** because of three coverage holes and roughly twenty wrong edges.

## The three holes, and why they mattered

**1. Nothing owned binary storage.** `T-061` (generated PDFs), `T-064` (signed PDFs), `T-070`
(camera uploads), `T-115` (documents attached to AlayaCare) and `T-130` (audited deletion)
all need a blob store. Five implementors across five waves would each have invented a path
scheme, and the reconciliation would have surfaced in wave 14 — the sole occupant of its
wave, immediately upstream of the end-to-end test. The extraction mock already assumed a
"fixture by filename" convention three waves before upload existed.

→ **`T-017`**, a storage port with a local-disk adapter and one key convention, in phase 1
before anything writes a byte.

**2. No task captured the fields the PDFs are filled from.** Phase 5 had a task per intake
section — save/resume, repeating blocks, home-care profile, restricted forms — but none for
Identity, Government IDs, or Payroll inputs. `T-061` was expected to fill a W-4 (filing
status, dependents, extra withholding), an IT-2104, a direct deposit form (routing and
account), and CHRC-102 (height, weight, eye and hair colour) from fields nobody collected.

→ **`T-046`**, plus an ABA routing checksum added to `T-004`.

**3. `T-130` deleted documents that did not exist yet.** Retention sat in wave 4 with only
the audit log, the queue and the restricted stores available — but it deletes
`UploadedDocument` (wave 7), `SignedDocument` (wave 10), blobs, and applicant data keyed off
invite expiry (wave 7). It would have been written twice.

→ Dependencies added; it now lands in wave 11.

## New tasks

| Task | Why |
| --- | --- |
| `T-017` storage port | see above; highest-value addition |
| `T-018` scheduler | `T-016` is a *retry* queue. "Escalate after two misses", scheduled file import, and retention need due-at and recurring jobs. Three tasks would have invented three crons. |
| `T-019` masking UI | split from `T-014` — different layer, different deps; splitting unblocks auth a wave earlier |
| `T-023` MFA (TOTP) | the PRD requires "SSO **or** enforced MFA". SSO is deferred, so an "MFA-enforced flag" that enforces nothing satisfies neither limb |
| `T-024` agency user management | "Agency admin … configures requirements, integrations, **and users**" had no owner |
| `T-036` role axis + re-materialisation | "Show only the sections required by the caregiver's state **and role**" was uncovered, and it is circular: the certification level that determines the role is captured *inside* intake, so instances must re-materialise mid-flow |
| `T-046` sensitive intake sections | see above |
| `T-047` canonical field binding | split from `T-040`, which was the largest node in the graph and gated five tasks |
| `T-077` issuer allowlist | "Check issuers against an **agency-maintained** list" — `T-073` assumed the list existed; nothing created it or its CRUD. Without it the judge's short-circuit is a hardcoded array and the PRD's stated risk mitigation is not real |
| `T-114` AlayaCare export fallback | the PRD's own mitigation for its single biggest risk had no task |
| `T-115` sync credentials + documents | split from `T-111`, which bundled three write paths against a deliberately adversarial mock as the sole task in its wave |
| `T-123` exception resolution | `T-121` was display-only. Nothing owned accept-over-judge, reject, waive, or request-re-upload — so the `WAIVED` status was unreachable and the workflow diagram's loop back into review was unimplemented |
| `T-140` EEOC aggregate report | `T-045` wrote EEOC data and nothing ever read it; the "suppress groups below five" rule had no owner |
| `T-141` metrics and reports | no task existed for any row of the Success metrics table, though `T-015` and `T-111` already emit the raw events |

## Merges

`T-063` (attestation-only documents) folded into `T-062`. Identical dependency set, identical
output shape, and "no data entry" is the whole point — it is a list and a renderer.

## Dependency corrections applied

| Task | Change |
| --- | --- |
| `T-011`, `T-045` | + `T-013` — restricted accessors audit every read, but had no path to the audit log |
| `T-070` | `T-044` → `T-021` — upload needs a caregiver *session*, not the offer trigger. Shortened the critical path by a wave |
| `T-081` | `T-064` → `T-062` + `T-052` — FCRA consent is *standalone* by law; gating it on the whole envelope was both wrong in shape and four waves late |
| `T-083` | − `T-071` — health screening is requirement instances plus the medical store, not OCR. Freed it from wave 10 to wave 6 |
| `T-034` | `T-032` → `T-031` — editing templates needs the resolver, not per-caregiver instances |
| `T-100` | + `T-064`, `T-011` — evidence includes signed documents; supervisors see medical *results* |
| `T-080` | + `T-061` — the tracked process starts with a generated CHRC-102 |
| `T-082`, `T-090`, `T-075`, `T-130` | + `T-018` — all need scheduling |
| `T-131`, `T-132`, `T-121`, `T-044`, `T-053`, `T-061`, `T-062`, `T-064`, `T-073` | various undeclared needs made explicit |

## Wave 5/6 collision, mitigated in `T-050`

Eight adapter tasks land concurrently and each would append to `src/lib/env.ts`,
`src/integrations/registry.ts` and `src/server/auth/policy.ts`. `T-050` now pre-declares
every port slot and env var so adapter tasks fill an existing slot instead of appending.
Without that, the wave costs more in merge resolution than the parallelism saves.

## Critical path — corrected

Revision 1's DAG.md claimed 13 tasks through `T-050 → T-053 → T-071`. Every edge existed but
it was not the longest path. Computed from revision 2:

```
T-001 → T-002 → T-010 → T-016 → T-050 → T-051 → T-021 → T-070 → T-071
      → T-072 → T-074 → T-100 → T-101 → T-111 → T-115 → T-112
```

Sixteen tasks. The binding predecessor of `T-071` is `T-070` (upload), not `T-053`
(extraction adapter) — so messaging, caregiver auth and document upload are on the path, and
revision 1 was protecting the wrong tasks.

## Accepted with modification

The reviewer suggested folding `T-102` (credential registry) into `T-074` or `T-100`. Kept
separate: it owns the `Credential` model, which `T-115` writes to AlayaCare and `T-141`
reports on. That is a real entity, not just a projection.

## Biggest remaining risk, per the review

`T-061` — filling official PDFs. It reads as one line and is six unrelated sub-projects.
Government AcroForms have opaque field names (`topmostSubform[0].Page1[0].f1_01[0]`),
inconsistent checkbox export values, and some IRS and state forms are XFA-hybrid or
flattened — in which case pdf-lib cannot fill them at all and the task silently becomes
"draw text at measured coordinates on a background image", a different job with a different
failure mode. Its planner must establish which forms are fillable **before** design.
