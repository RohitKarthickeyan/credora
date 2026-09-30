# Text-message onboarding demo — design

Status: approved 2026-09-30 (revised the same day: web phone instead of Twilio, three documents,
staff-completed background check, no AlayaCare sync) · Source: `docs/HH Workflow Summary.pdf`

## Goal

A live demo for Alvita Care staff. One caregiver goes from "offer accepted" to "ready for
AlayaCare" entirely by text message, while a staff member watches and acts in the admin portal.
For the demo the caregiver's phone is a web page styled as a text thread; the only other page the
caregiver opens is DocuSeal's signing page.

Success: in one sitting the presenter, acting as the caregiver on the web phone, completes intake,
signs, sends three documents, gets one returned and resends it, is approved by staff, and is marked
ready for AlayaCare, with every step visible in the admin portal.

## Decisions

| Topic | Decision |
| --- | --- |
| Caregiver channel | A web phone page (`/dev/phone/[caregiverId]`) that sends and receives through the messaging port's mock adapter. No Twilio in this demo; the port keeps the shape a Twilio adapter would fill. |
| Model | A low-cost OpenAI model (`gpt-5-mini`, low reasoning effort) for the agent and the judge, through the official `openai` SDK with Structured Outputs. The id lives in one constant. |
| Agent role | Code decides every step and outcome. The model turns a caregiver's text into a typed event for the current step, and answers questions from a fixed FAQ plus the caregiver's status. |
| Hosting | The developer's machine. No tunnel is needed. |
| E-sign | DocuSeal, self-hosted in `docker-compose.yml`, behind the existing e-sign port. |
| Text extraction | PaddleOCR in its own container, behind the existing extraction port. |
| Stack | Next.js stays. |
| Intake | Legal name (confirmed at read-back), date of birth, sex, email, home address, SSN. |
| Documents | HHA certificate, TB test result (PPD), driver's license, each a photo. |
| Background check | Staff click "Background check completed" once every document is approved. That click is also the clearance sign-off. |
| Demo end | The caregiver shows as "Ready for AlayaCare" in the portal and gets a "you're cleared" text. Nothing is sent to AlayaCare. |
| Tests | A few unit tests for pure rules. No scripted conversation evals: the conversation is tested by hand on the web phone. |

Out of scope: Twilio and real SMS; W-4, I-9 and the rest of the NY packet; references, training,
EEOC and the medical questionnaire; deleting the caregiver web portal; the AlayaCare sync.

## The flow

1. **Invite.** Staff add the caregiver in the admin portal: legal name, mobile number, work state
   "Demo", service type (email optional). The agent texts first.
2. **Intake by text.** The agent asks, one at a time, for each field still empty: date of birth,
   sex, email, home address, SSN. It then reads everything back (legal name, the SSN as its last
   four) and asks the caregiver to confirm or correct.
3. **Sign.** On confirmation the demo intake form and the FCRA disclosure are generated as one
   DocuSeal envelope, and the agent texts the signing link.
4. **Documents.** After signing, the agent asks for a photo of the HHA certificate, then the TB
   result, then the driver's license.
5. **Checks** on each photo: OCR reads the text; rules find the caregiver's name, date of birth and
   the document dates; the judge assesses issuer and document type from redacted text.
   - Unreadable, expired, name not found or date of birth different: texted back with the reason,
     and the agent asks again.
   - Everything else goes to the staff queue. Nothing is auto-accepted.
6. **Approval.** Staff approve or reject each document. A rejection is texted with the reason and
   the agent asks again; an approval is texted as a status update.
7. **Background check.** When every document is approved, staff click "Background check
   completed". The caregiver becomes "Ready for AlayaCare" and the agent texts "You're cleared".
8. **Throughout.** The caregiver can ask questions at any step. The agent answers from the FAQ and
   the caregiver's current status, and anything else is flagged to staff.

## Architecture

```
web phone ─server action─▶ receiveText (redact, store Message) ──enqueue──▶ conversation.turn
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────┘
   ▼
 derive step ▶ interpret (model, the step's events only) ▶ apply (use case as the caregiver)
   ▶ derive next step ▶ compose reply ▶ output check ▶ messaging port (mock) ▶ Message row
```

Layering as in `ARCHITECTURE.md`: pure rules in `src/domain/conversation/`, the turn in
`src/server/conversation/`, the model behind a new `agent` port. A Twilio adapter later replaces the
web phone's server action with a webhook route that calls the same `receiveText`.

### Conversation step: derived, not stored

`nextStep(snapshot)` in `src/domain/conversation/` is recomputed every turn from the caregiver's
record: pipeline stage, which intake fields are empty, the envelope state, the three document
instances (with the latest return reason), and whether the conversation is paused.

| Step | When |
| --- | --- |
| `ASK_FIELD(field)` | stage `INVITED`/`INTAKE` and a field is empty, in order: DOB, sex, email, address, SSN |
| `CONFIRM_INTAKE` | stage `INVITED`/`INTAKE`, all fields present |
| `AWAIT_SIGNATURE` | stage `SIGNING` |
| `REQUEST_DOCUMENT(key)` | a document instance is `NOT_STARTED` (HHA, then TB, then license) |
| `FIX_DOCUMENT(key, reason)` | a document was returned by the checks or rejected by staff |
| `AWAIT_REVIEW` | every document uploaded, staff not finished, or waiting on the background check |
| `CLEARED` | stage `SYNCING` or `ACTIVE` |
| `HANDED_OFF` | paused by staff, or three unclear replies in a row |
| `STOPPED` | withdrawn, or the caregiver texted STOP |

The only new stored state is on `Conversation`: the last step asked (`awaitingStep`) and the count
of consecutive unclear replies.

### A turn

One `conversation.turn` job per inbound message, serialised per caregiver by locking the
`Conversation` row.

1. **Redact** (in `receiveText`, before anything is stored): nine-digit SSN-shaped numbers are
   encrypted and replaced by `[SSN]`. The `Message` row holds the redacted body and the ciphertext.
2. **Derive** the current step.
3. **Interpret.** The model gets the step, the caregiver's status, the FAQ, the last few messages,
   and only that step's event schemas (Zod). Output that fails the schema is `unclear`.
4. **Apply** the event as the caregiver's principal (`caregiverPrincipalFrom` + `runAsPrincipal`).
   Values are validated with the existing zod primitives; a value that fails counts as `unclear`.
   The SSN ciphertext is decrypted only here, to be written to the SSN column.
5. **Derive** the next step.
6. **Compose.** Every prompt, failure reason, signing link and status line is a fixed template.
   The model's own words appear only in answers to questions.
7. **Output check** (deterministic): no nine-digit numbers, no URL except our own and DocuSeal's,
   at most 480 characters. A failing answer becomes "I'll pass that to the team".
8. **Send** through the messaging port and store the outbound `Message`.

A photo sent during `REQUEST_DOCUMENT` or `FIX_DOCUMENT` is uploaded with `uploadOwnDocument` for
that instance; no model call is made. A photo at any other step gets "I'll ask for documents after
you've signed".

### Texts not caused by a reply

Envelope sent, envelope signed, a returned document, a staff approval or rejection, and clearance
each enqueue `conversation.nudge`, which sends a status line (when there is one) and the current
step's prompt. The invite enqueues the first nudge.

### Identity

The web phone knows the caregiver; `receiveText` still resolves them by the sender's number
(`ContactRecord.mobilePhone`, unique among live caregivers of the agency), which is what a Twilio
webhook will do.

### Data model additions

- `Conversation`: `caregiverId` (unique), `agencyId`, `phone`, `awaitingStep`, `unclearCount`,
  `pausedAt`, `optedOutAt`.
- `Message`: `conversationId`, `agencyId`, `direction` (`INBOUND`/`OUTBOUND`), `author`
  (`CAREGIVER`/`AGENT`/`STAFF`), `body` (redacted), `ssnEnc`, `mediaStorageKey`, `createdAt`.
- Invite: mobile phone required, email optional.

## Parts of the system

- **Messaging port:** gains `sendText({ agencyId, to, body, idempotencyKey })`. The mock returns
  `sent`; the conversation code stores the `Message`.
- **Agent port:** `interpret(input) → AgentEvent`. Adapters `openai` (Structured Outputs, no sampling
  parameters) and `mock` (a small deterministic parser so dev runs without a key).
  `AGENT_ADAPTER`, `OPENAI_API_KEY`.
- **Intake by text:** one `INTAKE_TEXT` form requirement, satisfied by an attestation when the
  caregiver confirms the read-back. Answers are written to the canonical identity and contact
  columns. Email goes through the same per-agency uniqueness check as the invite.
- **Demo requirement set:** a `DEMO` state with platform templates `INTAKE_TEXT`,
  `DEMO_INTAKE_FORM` (signed), `AIDE_CERTIFICATION` (HHA), `TB_TEST` and `PHOTO_ID`, plus the
  agency-wide `FCRA_DISCLOSURE` and `BACKGROUND_CHECK`. The agency's other agency-wide templates
  (PHI acknowledgement, emergency contacts, EEOC) are scoped to NY. `TB_TEST` is not a health
  screening key, so staff approval satisfies it without a recorded clinic result.
- **E-sign (DocuSeal):** container plus a `docuseal` adapter. `createEnvelope` uploads the PDFs and
  returns the signing URL; DocuSeal sends no email. Its completion webhook follows the existing
  `/api/webhooks/esign` path.
- **OCR (PaddleOCR):** a Python service in `services/ocr/` returning text lines with confidences,
  and a `paddleocr` adapter. Pure rules in `src/domain/documents/` find the caregiver's name, date
  of birth and the dates in that text.
- **Review outcome:** `autoAcceptOutcome` is replaced by `reviewOutcome`, which returns
  `RETURN(reason)` or `STAFF`. A returned document's instance goes to `EXCEPTION` and shows under
  "Waiting on the caregiver"; a staff one goes to `EXCEPTION` under "Needs a decision". Only a staff
  approval satisfies a document.
- **Judge:** a new `openai` judge adapter becomes the one the demo selects (`JUDGE_ADAPTER=openai`).
- **Background check completed:** a staff use case, allowed only for `DEMO` caregivers in
  `VERIFICATION`, that records the check, applies verification and clearance, and does not enqueue
  the AlayaCare sync. `SYNCING` is labelled "Ready for AlayaCare".
- **Admin portal:** invite with phone; caregiver page with transcript, pause/resume and a reply
  box; a conversations list; the queue shows the check results; the pipeline board is the list of
  every caregiver's status.

## Errors

- **Model error or timeout:** the turn retries with the queue's backoff; after the last retry the
  caregiver gets "Sorry, something went wrong. Someone from the team will follow up", and the
  conversation is handed off.
- **Unparseable model output or an invalid value:** `unclear`; the question is asked again; three
  in a row hands off.
- **OCR service down:** extraction retries; after the last retry the document goes to staff.
- **DocuSeal down:** the send-envelope job retries.

## Decisions recorded

ADR-162 to ADR-166 in `docs/context/DECISIONS.md`, and entry 2 in `AGENTIC-TASKS.md`.

## Testing

Unit tests in `src/domain/` only: `nextStep`, redaction, the output check, the OCR field finder,
and `reviewOutcome`. The conversation is tested by hand on the web phone. Everything else is
verified by `npm run build` and `npm run lint`.

## Demo prerequisites (owner actions)

- An OpenAI API key.
- Docker running Postgres, DocuSeal and the OCR service; a DocuSeal admin account and API key.
- Photos of an HHA certificate, a TB result and a driver's license in the demo caregiver's name,
  plus one expired or mismatched document to show a return.
