# Progress

Where the project stands and what comes next. Update it when a plan starts and when it is
finished. Task-level progress inside a plan lives in that plan's superpowers ledger, not here.

## Current plan

None yet. **Next step:** `superpowers:brainstorming` for the SMS redesign below.

## Direction: SMS agent for caregivers (started 2026-09-30)

The caregiver web portal is replaced by an SMS agent; the staff admin portal stays. Source:
`docs/HH Workflow Summary.pdf` (goals, certification processing, general flow, architecture
diagram).

- The agent sits on a deterministic state machine. Code decides every step and outcome; the
  model only turns caregiver texts into typed events for the current step and phrases replies.
- This supersedes ADR-161 (no SMS) and needs a new `AGENTIC-TASKS.md` entry, both as ADRs.
- Documents that pass the automatic checks go to staff for approval instead of auto-accept.
  Failures go back to the caregiver by text.
- The portal is deleted only after the SMS flow reaches parity. Work lands directly on
  `main`, so each plan must leave it working and demoable.

Open decisions for brainstorming:

1. Keep Next.js, or move to Hono + React/Vite as the diagram shows (recommended: keep).
2. How much of the 12-section intake the agent collects for the demo.
3. SSN and bank details typed into SMS and redacted, or sent through a one-field secure link.
4. Real Twilio, DocuSeal and PaddleOCR for the demo, or the existing mocks.
5. Whether the judge moves from `claude-opus-5` to Haiku.

## Baseline: V1 web-portal build (commit 435a084)

Built by the former DAG flow, 94 of 96 tasks; recoverable from commit 66015f7.

- **Works:** staff portal (pipeline, caregiver detail, exception queue, clearance, reports,
  admin), requirements engine with NY templates, caregiver web intake and e-sign, document
  review (extraction mock, identity matching, Claude judge, issuer allowlist), background-check
  mock, references, training import, AlayaCare sync against the mock server, retention.
- **Messaging** is email only (ADR-161). Caregivers sign in with an emailed code.
- **Never finished:** an end-to-end happy-path test (T-133), and the check of the test-suite
  prune (T-143). Neither will be resumed.
- **Tests:** none. The suite was removed on 2026-09-28; it returns lean under
  `CONVENTIONS.md` § Tests.
- **Where code lives:** `docs/context/MODULES.md`.

## Finished plans

None yet.
