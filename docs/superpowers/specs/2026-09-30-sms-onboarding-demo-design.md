# SMS onboarding demo — design

Status: draft for review · 2026-09-30 · Source: `docs/HH Workflow Summary.pdf`

## Goal

A live demo for Alvita Care staff. One caregiver goes from "offer accepted" to "active in
AlayaCare" entirely by real text messages, while a staff member watches and acts in the admin
portal. The only web page the caregiver opens is DocuSeal's signing page.

Success: in one sitting, on a real phone, the caregiver completes intake, signs, sends two
certifications, is cleared by staff, and appears as an employee on the AlayaCare mock, with
every step visible in the admin portal.

## Decisions

| Topic | Decision |
| --- | --- |
| Caregiver channel | Real SMS/MMS via Twilio, behind the messaging port. Start A2P 10DLC registration now. |
| Model | Claude Haiku 4.5 for the agent and the judge. Exact model id and SDK usage come from the `claude-api` skill at implementation time. |
| Agent role | Code decides every step and outcome. The model turns a caregiver's text into a typed event for the current step, and phrases prompts. |
| Hosting | The developer's machine through a tunnel with a fixed address (ngrok or Cloudflare Tunnel). |
| E-sign | DocuSeal, self-hosted, behind the existing e-sign port. |
| Text extraction | PaddleOCR in its own container, behind the existing extraction port. |
| Stack | Next.js stays. The diagram's Hono/Vite/MinIO are not adopted. |
| Intake | Legal name, date of birth, email, home address, SSN, collected by text. SSN typed into SMS and redacted. |
| Certifications | Aide certification (HHA/PCA) and TB screening. |
| Demo end | Background check, clearance sign-off, AlayaCare sync, "you're cleared" text. |

Out of scope: W-4, I-9 and the full document packet; references, training, EEOC and the medical
questionnaire; deleting the caregiver web portal (a later plan); iMessage; production SMS
registration details.

## The flow

1. **Invite.** Staff add the caregiver in the admin portal: legal name and mobile number
   (email optional). The agent texts first.
2. **Intake by text.** The agent asks, one at a time, for anything still missing: legal name
   (confirm), date of birth, email, home address, SSN. It then reads the answers back (SSN as last
   four) and asks the caregiver to confirm.
3. **Sign.** On confirmation the intake document and the FCRA disclosure are generated and sent
   as one DocuSeal envelope. The agent texts the signing link.
4. **Certifications.** After signing, the agent asks for a photo of the aide certification, then
   the TB screening result.
5. **Checks** on each photo: PaddleOCR reads the text; rules find the caregiver's known name and
   date of birth and the dates; the Haiku judge assesses issuer and document type from redacted
   text.
   - A deterministic failure (unreadable, expired, name or DOB not found) is texted back with the
     reason, and the agent asks again.
   - Everything else goes to staff for approval. Nothing is auto-accepted.
   - For TB, after staff approve the document a supervisor records the result, as today.
6. **Background check.** Ordered automatically once the FCRA disclosure is signed. The mock is
   advanced from `/dev/background-check`.
7. **Clearance.** A supervisor signs off; the AlayaCare sync creates the employee on the mock
   server; the agent texts "You're cleared to work".

## Architecture

```
Caregiver phone ⇄ Twilio ⇄ /api/webhooks/twilio ──enqueue──▶ conversation.turn job
                                                              │
   ┌──────────────────────────────────────────────────────────┘
   ▼
 redact ▶ derive step ▶ interpret (model, step's events only) ▶ apply (use case as caregiver)
        ▶ derive next step ▶ compose reply ▶ output check ▶ messaging port ▶ Twilio
```

Everything reuses the layering in `ARCHITECTURE.md`: pure rules in `src/domain/conversation/`,
the turn orchestration in `src/server/conversation/`, vendors behind ports.

### Conversation step: derived, not stored

The next step is a pure function of the caregiver's record, recomputed every turn:

`nextStep(snapshot) → ConversationStep` in `src/domain/conversation/`, where the snapshot holds
the pipeline stage, which intake fields are empty, the envelope state, the open requirement
instances (with any caregiver-fixable failure reason), and whether the conversation is paused.

| Step | When |
| --- | --- |
| `ASK_FIELD(field)` | an intake field is empty, in order: name, DOB, email, address, SSN |
| `CONFIRM_INTAKE` | all fields present, envelope not yet sent |
| `AWAIT_SIGNATURE` | envelope sent, not signed |
| `REQUEST_DOCUMENT(instance)` | a certification is not yet uploaded (aide, then TB) |
| `FIX_DOCUMENT(instance, reason)` | the last upload failed a deterministic check |
| `AWAIT_REVIEW` | everything is uploaded, staff have not finished |
| `CLEARED` | stage is `SYNCING` or `ACTIVE` |
| `HANDED_OFF` | paused by staff, or too many unclear replies |
| `STOPPED` | withdrawn, or the caregiver texted STOP |

The only new stored state is what we last asked (`Conversation.awaiting`), so a reply like
"03/14/1988" is read against the right question, plus a count of consecutive unclear replies.
Staff actions in the portal (reject a certificate, withdraw someone) change the record, so the
next turn sees them without any syncing.

### A turn

`conversation.turn` job, one per inbound message (idempotency key = Twilio `MessageSid`), serialised
per caregiver by locking the `Conversation` row.

1. **Redact.** This happens in the webhook route, before the payload is persisted, because the
   webhook pattern stores the raw payload. SSN-shaped digits are encrypted with the field
   encryption key and replaced in the text by `[SSN_1]`; the persisted payload and the stored
   `Message.body` hold only the placeholder and the ciphertext. (Bank and ID numbers are not
   collected in this demo; the same step covers them later.)
2. **Derive** the current step.
3. **Interpret.** The model gets the step, the last few messages and only that step's events,
   defined as Zod schemas: for `ASK_FIELD(dateOfBirth)`, `answer{ value }`, `question{ text }`,
   `unclear`. Its output is parsed with the schema; anything else counts as `unclear`.
4. **Apply** the event through existing use cases, run as the caregiver's principal (the
   `actAsCaregiver` pattern in `src/server/dev/demo-seed.ts`). Field values are validated by the
   existing zod primitives (DOB, address, SSN); a value that fails validation counts as `unclear`.
   The SSN placeholder is decrypted only inside this step, and only to be written to the
   encrypted SSN column.
5. **Derive** the next step.
6. **Compose** the reply. Anything consequential is a fixed template: failure reasons, the signing
   link, the SSN request, "cleared". The model may phrase only the plain prompts and short
   answers to off-topic questions from a fixed FAQ in the prompt; otherwise "I'll pass that to
   the team", which flags the conversation for staff.
7. **Output check** (deterministic): no nine-digit sequences, no URL except our own and
   DocuSeal's, at most three SMS segments. A failing reply is replaced by the step's template.
8. **Send** via the messaging port and store the outbound `Message`.

Photos: an inbound MMS during `REQUEST_DOCUMENT` or `FIX_DOCUMENT` is downloaded, stored through the
storage port and passed to `uploadOwnDocument` for that instance. No model call is needed. A photo
at any other step gets "I'll ask for documents after you've signed", and is not stored.

After three consecutive unclear replies, the step becomes `HANDED_OFF` and staff are alerted.

### Outbound messages not caused by a text

Some texts start from an event, not a reply: the invite, the signing link once the envelope is
sent, a failed check, a staff rejection, clearance. Each of these enqueues `conversation.nudge`,
which derives the step and sends that step's template. `caregiverNoticeJob` is replaced by this.

### Identity and sign-in

- The caregiver is identified by the inbound `From` number, matched to `ContactRecord.mobilePhone`
  among live caregivers of the agency that owns the Twilio number. Mobile numbers are unique per
  agency among live caregivers, checked in code as email is today.
- An unknown number gets one reply ("This number isn't registered with an agency") and nothing is
  stored.
- Twilio's opt-out handling is kept: STOP stops the conversation and it is recorded.

### Data model additions

- `Conversation`: `caregiverId` (unique), `agencyId`, `phone`, `awaiting` (step key and target),
  `unclearCount`, `pausedAt`, `optedOutAt`.
- `Message`: `conversationId`, `direction`, `body` (redacted), `mediaStorageKeys`,
  `providerMessageId` (unique), `createdAt`.
- Invite: mobile phone required; email optional.

## Parts of the system

### Messaging (Twilio)

- The messaging port gains `sendSms({ agencyId, to, body, idempotencyKey })` and inbound webhook
  verification. Email stays for staff invites.
- Adapters: `twilio` (real) and `mock` (writes `SentMessage`, used for evals and dev without a
  phone). Selected by `MESSAGING_ADAPTER`.
- Inbound route: `/api/webhooks/twilio`, following the existing webhook pattern: verify the
  `X-Twilio-Signature`, redact (see A turn, step 1), persist, enqueue, return 200. The signature covers the full public URL, so
  `APP_URL` must be the tunnel address.
- MMS media is fetched with the account credentials in the job, not in the route.
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

### Agent model adapter

- A new `agent` port: given a step, its event schemas and recent messages, return one event.
- Adapters: `claude` (Haiku 4.5, structured output, no sampling parameters) and `mock`: a
  deterministic parser per step (dates, yes/no, email, address lines) so evals and dev need no API.
- Selected by `AGENT_ADAPTER`. Uses `ANTHROPIC_API_KEY`.

### Intake by text

- Two compact intake sections for SMS, bound to the same canonical columns (identity: name, DOB,
  SSN; contact: address). Email is written through a use case that enforces per-agency
  uniqueness.
- Existing sections have required fields SMS does not collect (sex, marital status and so on);
  the SMS sections are what the demo requirement set asks for, so those fields are never required.

### Demo requirement set

- Clearance requires every blocking requirement, and the NY set has about 25, so the demo uses its
  own set: the two SMS intake sections, the intake document, the FCRA disclosure, the aide
  certification, TB screening and the background check.
- It is seeded under a separate jurisdiction code, `DEMO`, added to `STATES`, with its own
  platform seeder. The rule code is unchanged. Staff pick "Demo" as the work state at invite.

### E-sign (DocuSeal)

- A DocuSeal container in `docker-compose.yml`, and a `docuseal` adapter behind the e-sign port.
  `createEnvelope` uploads the generated PDFs and returns the submitter's signing URL; nothing is
  emailed by DocuSeal.
- DocuSeal's completion webhook arrives at `/api/webhooks/esign` and follows the existing path
  (`esignWebhookJob`: signed copies stored, instances satisfied, `ENVELOPE_COMPLETED`).
- The intake document is an agency template filled from the intake answers; the FCRA disclosure
  is the existing `FCRA_DISCLOSURE` template. Both go in one envelope.
- Env: `ESIGN_ADAPTER=docuseal`, `DOCUSEAL_URL`, `DOCUSEAL_API_KEY`.

### Certifications (PaddleOCR, rules, judge, staff)

- **OCR service:** a small Python HTTP service wrapping PaddleOCR (CPU), in
  `services/ocr/` with its own Dockerfile, returning text lines with confidences. A `paddleocr`
  adapter behind the extraction port. Env: `EXTRACTION_ADAPTER=paddleocr`, `OCR_URL`.
- **Matching rules** (pure, `src/domain/documents/`): find the caregiver's known legal name
  (tolerant of OCR errors and middle names) and date of birth in the lines; find issue and expiry
  dates by label ("Expires", "Exp", "Date of Test", "Read"), else by position. These produce the
  port's existing fields, so identity matching downstream is unchanged.
- **Expiry:** date arithmetic against the requirement's validity, never asked of the model.
- **Judge:** the existing judge, moved to Haiku 4.5. It still receives only redacted text.
- **Outcome change:** `autoAcceptOutcome` no longer accepts. Its result becomes one of
  - `RETURN_TO_CAREGIVER(reason)`: unreadable, expired, name or DOB not found. The instance stays
    open for a new upload, and `conversation.nudge` texts the reason.
  - `STAFF_APPROVAL(checks)`: everything else, including judge verdicts. It lands in the staff
    queue with the check results shown; the staff member approves or rejects.
- A staff approval is the only way a certification is satisfied. TB then continues to the
  supervisor's recorded result, unchanged.

### Background check, clearance, sync

- When the envelope completes with `FCRA_DISCLOSURE` signed, the background check is ordered
  automatically by a job running as the system. The existing FCRA gate still applies.
- Clearance sign-off and the AlayaCare sync are unchanged. `SYNC_COMPLETED` triggers the "cleared"
  text.

### Admin portal

- Invite form: mobile phone required, email optional, "Demo" work state.
- Caregiver page: the conversation transcript (redacted), a pause/resume switch, and a box to send
  a manual text. Paused conversations get no agent replies.
- Queue: certifications awaiting approval show the check results (name found, DOB found, dates,
  judge verdict and reasons).

## Errors

- **Model timeout or error:** the turn job retries with the queue's backoff. After the last retry
  the caregiver gets "Sorry, something went wrong. Someone from the team will follow up", and the
  conversation is handed off.
- **Unparseable or invalid model output:** treated as `unclear` (step unchanged, question asked
  again); three in a row hands off.
- **Twilio send failure:** retried by the queue; a permanent rejection (such as an opted-out
  number) stops the conversation.
- **OCR service down:** extraction retries; after the last retry the document goes to staff.
- **DocuSeal down:** the send-envelope job retries; the caregiver is told the link is coming.
- **Duplicate webhooks:** absorbed by `MessageSid` and envelope-id idempotency.

## Decisions to record (ADRs, from ADR-162)

1. Credora texts caregivers by SMS; the mobile number identifies the caregiver in conversation.
   Supersedes ADR-161 for caregivers (staff stay on email).
2. A new `AGENTIC-TASKS.md` entry: the conversational agent interprets texts into typed events and
   phrases prompts; it decides nothing.
3. Certifications are never auto-accepted; deterministic failures return to the caregiver, and
   everything else goes to staff. Supersedes ADR-101's auto-accept, and makes ADR-109's weekly
   sample of auto-accepted records moot.
4. The judge moves to Claude Haiku 4.5.
5. The background check is ordered automatically once FCRA is signed. Supersedes ADR-125's
   staff-ordering rule.
6. A `DEMO` jurisdiction with its own requirement set.

## Testing

Per `CONVENTIONS.md` § Tests. Vitest is added in part 1.

- **Unit tests** (`src/domain/`): `nextStep` for each row of the step table; redaction (including
  that nothing SSN-shaped reaches a persisted payload); the output
  check; name, DOB and date finding on OCR lines; the new review outcome.
- **Agent evals:** scripted conversations run against the mock model through the turn logic
  (happy path, a typo corrected, an off-topic question, an expired certificate, a photo sent too
  early, three unclear replies). A few runs against Haiku are done by hand before the demo; they
  are not part of the suite.
- Everything else is verified by `npm run build` and `npm run lint`, and by rehearsing the demo.

## The four parts

Each part leaves `main` working. Dependencies are listed so the work can later be split between
people.

| Part | Contents | Depends on | Testable without SMS? |
| --- | --- | --- | --- |
| **1. Conversation core** | Vitest; SMS on the messaging port, Twilio and mock adapters, inbound webhook; `Conversation`/`Message`; agent port (Claude, mock); turn and nudge jobs; redaction and output check; `nextStep` for intake; SMS intake sections; demo requirement set; invite with phone and first text; transcript, pause and manual text in the portal; ADRs 1, 2, 6 | — | No (it is the SMS part) |
| **2. E-sign** | DocuSeal container and adapter; intake document template; one envelope with FCRA; signing link texted; `AWAIT_SIGNATURE` step | Part 1 for the texting only | Yes, by signing from the web portal |
| **3. Certifications** | OCR service and adapter; matching and expiry rules; judge on Haiku; review outcome change; staff approval view; MMS to upload; failure texts; ADRs 3, 4 | Part 1 for MMS and texts only | Yes, by uploading from the web portal |
| **4. Finish line** | Automatic background-check order; "cleared" text; demo runbook (tunnel, Twilio webhook, `docker compose up`, worker, AlayaCare mock, seed); full rehearsal; ADR 5 | Parts 1 and 2 | No |

## To confirm during planning

- Whether an existing agency template (for example the employment application) can serve as the
  intake document, or a new one is needed.
- The exact DocuSeal API calls for an embedded signing URL without email, and its webhook
  signature scheme.
- The PaddleOCR image, model download size and first-run time on a laptop CPU.
- Whether Twilio trial traffic reaches the demo phones before 10DLC approval.

## Demo prerequisites (owner actions)

- Twilio paid account, a number, and A2P 10DLC registration (several days).
- An Anthropic API key.
- A tunnel with a fixed address.
- The demo phones, and test certificates to photograph (one valid, one expired aide certificate,
  one TB result).
