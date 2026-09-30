# Agentic tasks register

**Default: no LLM.** This product is a rules engine. An LLM call at runtime is a liability —
non-deterministic, untestable, expensive, and in this domain an audit exposure. Everything
that can be a pure function is a pure function.

This file is the complete list of places an LLM is permitted. Adding an entry requires an ADR
in `DECISIONS.md` stating what deterministic approach was rejected and why.

---

## Permitted: 1 — Home-care record validity judge  (PRD module 3)

**Task ID:** T-054 (adapter) · T-073 (orchestration)

**Why it cannot be deterministic.** The PRD names this as discretionary judgement staff make
today: is this certificate from *a legitimate issuer* — "a recognized training program,
licensed clinic, or state agency"? For a known issuer that is a lookup against the agency's
allowlist, and we do that first. The residue is open-ended: an unfamiliar clinic letterhead,
a training program that renamed itself, a certificate whose layout does not match any
template. No finite rule set covers it, and getting it wrong in the conservative direction
just means more staff work, which is the acceptable failure mode.

**What stays deterministic around it** (this is most of the work):

| Concern | Mechanism |
| --- | --- |
| Is it expired? | Date arithmetic. Never asked of the LLM. |
| Do the dates make sense? | Rules: issue ≤ expiry, issue ≤ today, validity period matches the template. |
| Does it match the requirement? | Document-type mapping from the requirement template. |
| Known issuer? | Allowlist lookup. A hit short-circuits — the judge is never called. |
| Do the names/DOB match? | `domain/identity` rules. Never the LLM. |
| Final accept/reject | `domain/documents/autoAccept.ts`. The judge is one input among several; it cannot accept on its own. |

**Contract.** The judge port takes extracted document text + the requirement description and
returns `{ verdict: VALID | INVALID | UNCERTAIN, confidence: 0..1, reasons: string[] }` where
each reason quotes what it read. Any `UNCERTAIN`, any confidence below threshold, and any
`manualOnly` requirement routes to the exception queue.

**Constraints.** Zero-retention provider under a BAA. Redaction step strips every sensitive
field before the prompt is built. Every call logs input hash,
output, and model version to `JudgeDecision`. Staff sample auto-accepted records weekly.

**Implementation.** Port with two adapters:
- `mock` (default everywhere, including CI): applies the published criteria deterministically.
  Same input → same verdict.
- `claude`: real call. **Before writing it, load the `claude-api` skill** for current model
  ids and SDK usage — do not write model strings from memory. Use structured output with no sampling
  parameters (the model rejects `temperature`; ADR-035), and a strict zod parse of the response.

**Not the Agent SDK.** This is one bounded classification with a fixed schema, not a loop
needing tools or multi-step reasoning. A single Messages API call is the right size. If a
future version needs to *fetch* evidence about an issuer (search a state registry), that
becomes a tool-use loop and is the point at which the Claude Agent SDK earns its place —
record it as a new ADR then, not now.

---

## Considered and rejected

| Candidate | Why deterministic instead |
| --- | --- |
| Identity matching across documents | PRD explicitly says rule-based. Name/DOB/number comparison with normalisation, middle-name tolerance, and documented name changes is a finite, testable rule set. An LLM here would be unauditable for a step that must be explainable. |
| Field extraction from documents | A managed OCR service is the right tool. Structured extraction with per-field confidence, not generation. |
| Requirement template resolution | Pure layered override. Deterministic by definition. |
| Form filling | Field mapping to PDF AcroForm fields. Deterministic. |
| AlayaCare field mapping | Configuration authored by implementation staff. An LLM guessing at field mappings would silently corrupt the system of record. |
| Clearance decision | `every blocking instance is satisfied`. A boolean. |
| Exception triage / queue ordering | Ranking by blocker severity and days in stage. Arithmetic. |
| Reference chasing | Scheduled reminders with an attempt counter. |

---

## Development-time agent use (not runtime)

Building this product uses subagents (implementers and reviewers, via the superpowers skills). That is
development tooling and ships nothing. Nothing in `src/` may call an agent unless it appears
in the permitted list above.
