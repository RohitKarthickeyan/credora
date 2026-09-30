# Progress

Where the project stands and what comes next. Update it when a plan starts and when it is
finished. Task-level progress inside a plan lives in that plan's superpowers ledger, not here.

## Current plan

`docs/superpowers/plans/2026-09-30-text-onboarding-demo.md`, implementing
`docs/superpowers/specs/2026-09-30-sms-onboarding-demo-design.md` (revised 2026-09-30: web phone
instead of Twilio, three documents, staff-completed background check, OpenAI `gpt-5-mini`).

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

The first target is a live demo for Alvita staff; its decisions (web phone, OpenAI, DocuSeal,
PaddleOCR, Next.js kept, SSN by text, three documents) are in the spec above.

Owner actions: an OpenAI API key (needed from Task 6's manual check). Twilio is deferred (ADR-162).

## Baseline: V1 web-portal build (commit cc64b3c)

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
