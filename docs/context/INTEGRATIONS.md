# Integration layer

Six external systems. Every one sits behind a **port** so a new vendor is a new adapter file,
not a rewrite. We hold no credentials for any of them, so every port ships a deterministic
**mock adapter** that local dev runs against.

## Rules

1. A port is a TypeScript interface plus zod schemas for its inputs and results, in
   `src/integrations/ports/<port>.ts`. It is written in **our** vocabulary, never the vendor's.
2. Adapters live in `src/integrations/adapters/<port>/<vendor>.ts`. Every port has `mock.ts`.
3. Selection is by env var at startup in `src/integrations/registry.ts`. Nothing else
   chooses an adapter; nothing outside `src/integrations` imports an adapter directly.
4. Mocks are **deterministic**: same input → same output, seeded from fixtures in
   `src/integrations/adapters/<port>/fixtures/`. No randomness, no wall-clock dependence.
   This is what makes the review pipeline testable.
   *Rules 2 and 4 exception (ADR-047):* `alayacare` has no `mock.ts` and no `fixtures/`. Its mock
   is the HTTP server in `mock-servers/alayacare/` (seeded from its own `seed.ts`). It has two
   adapters: the HTTP client `adapters/alayacare/http.ts`, selected by `ALAYACARE_ADAPTER=mock`, and
   the manual-import export `adapters/alayacare/export.ts`, selected by `ALAYACARE_ADAPTER=export`
   (ADR-153, ADR-154).
5. Every outbound call goes through the job queue (`src/integrations/queue/`) with retries,
   backoff, idempotency keys, and a persisted log. Callers enqueue; they do not await vendors.

## Ports

| Port | Vendor (later) | Mock behaviour | Env |
| --- | --- | --- | --- |
| `messaging` | an email provider (e.g. SendGrid) | Email for staff; text for caregivers through `sendText` (ADR-162). The mock returns sent; the conversation stores each `Message`, and the dev web phone at `/dev/phone/[caregiverId]` shows them. Email writes to a `SentMessage` table; `/dev/outbox` renders them, and sign-in codes are readable there in dev. | `MESSAGING_ADAPTER` |
| `esign` | DocuSeal, self-hosted (`docuseal` in `docker-compose.yml`, `ESIGN_ADAPTER=docuseal`) | Creates an envelope, exposes a local signing page, stamps a signature into the PDF with pdf-lib, fires the webhook back into our own route. The DocuSeal adapter uploads the PDFs as one template, sends no email, and returns DocuSeal's signing link; see its header for where the free edition differs from the API docs. | `ESIGN_ADAPTER`, `DOCUSEAL_*` |
| `extraction` | Textract / Document AI | Reads the bytes through the storage port and selects a fixture by **SHA-256 of the content**, returning the recorded fields with confidences. Unknown content returns low confidence → exception. | `EXTRACTION_ADAPTER` |
| `judge` | Claude (see `AGENTIC-TASKS.md`) | Rule-based: applies the same published criteria deterministically, returns verdict + confidence + reasons. | `JUDGE_ADAPTER` |
| `backgroundCheck` | agency's existing vendor | State machine `ORDERED → PENDING → CLEAR \| CONSIDER`, advanced by a dev control, never by a timer. Order state is JSON files under `STORAGE_ROOT/_mock-background-check/`, shared by the web app and the worker; the dev control is `/dev/background-check`. | `BGCHECK_ADAPTER` |
| `alayacare` | AlayaCare API | A real local HTTP server (`mock-servers/alayacare`) speaking the subset of AlayaCare's published employee API that the adapter calls (ADR-160): employees, profile attributes, skills, employee skills, attachments. Not an in-process stub — the sync engine must exercise real HTTP, retries, and retry safety. | `ALAYACARE_ADAPTER`, `ALAYACARE_BASE_URL` |
| `training` | agency training platform | Reads a CSV fixture as the "scheduled file" import; also serves an API shape. | `TRAINING_ADAPTER` |
| `storage` | S3 / GCS | Local disk under `storage/`. Not a vendor integration, but the same shape: one place that owns where a byte goes. | `STORAGE_ADAPTER`, `STORAGE_ROOT` |
| `agent` | OpenAI `gpt-5-mini` | Deterministic parser for dates, F/M/X, emails, addresses, yes; `?` is a question with no answer | `AGENT_ADAPTER` |

Every `*_ADAPTER` defaults to `mock`. There is no code path that requires a real credential.

## The AlayaCare mock deserves its own note

It is the highest-risk integration in the PRD. Since ADR-160 the mock follows AlayaCare's
published OpenAPI (developer.alayacare.com) for only the endpoints the adapter calls, under
`/ext/api/v2/employees`, with HTTP Basic auth whose public key selects the tenant. Where the docs
are silent the mock marks its behaviour `// Assumed, not documented:`. What that means for the adapter:

- Custom fields are profile attributes: keys listed by `GET /profile/employee`, written into the
  employee's `demographics` map.
- A credential is an employee skill; a mapping's credential code is the AlayaCare skill id.
- A document is an attachment file, uploaded under `Credora/`.
- The API has no idempotency header, so retry safety is the adapter's: the caregiver id as
  `external_id` (409 on a replayed create), an existing identical skill, an identical file at the
  same path.
- The API has no DOB conflict or duplicate check. The adapter compares name and birthday itself, so
  an existing profile with a different DOB is still a conflict, surfaced not overwritten.
- 429 and 503 responses on a fixed schedule → forces real retry handling (not in the docs).
- A "preview" endpoint we build ourselves by diffing, because the real API has none.

If AlayaCare access turns out to be unavailable, the fallback in the PRD is a structured
export for manual import. That is a second adapter (`alayacare/export.ts`) against the same
port, not a new subsystem.

## Storage keys

Every binary in the system — camera uploads, generated PDFs, signed PDFs — is addressed by
one key convention, owned by `T-017` and used unchanged by everything downstream:

```
<agencyId>/<caregiverId>/<kind>/<ulid>.<ext>
kind = upload | generated | signed | clinical
```
`clinical` holds clinic results (TB, physical, immunization) apart from personnel documents (ADR-068).

The key is what is stored on `UploadedDocument` and `SignedDocument`, what the extraction
mock looks a fixture up by, what the sync streams to AlayaCare, and what retention deletes.

> **Corrected 2026-09-23 (raised by T-050's planner).** An earlier version of the `extraction`
> row said the mock "looks up the uploaded fixture by filename". That cannot work: under ADR-005
> the filename segment of a storage key is a freshly minted ULID, so it carries nothing a fixture
> could be keyed on. ADR-005 § Because already records that the mock's filename scheme predated
> the key convention. T-053 selects by SHA-256 of the content read through the storage port —
> deterministic, and it needs no `fixtureHint` field leaking test concerns into the port.
Nothing else invents a path. This is deliberate: five tasks across five waves write bytes,
and without one convention they would write five.

## Env vars

`.env.example` is the authoritative list. Every variable is parsed by a zod schema in
`src/lib/env.ts` at startup; a missing or malformed variable fails the boot loudly rather
than at first use.

```
DATABASE_URL
FIELD_ENCRYPTION_KEY          32-byte base64
SESSION_SECRET
APP_URL
MESSAGING_ADAPTER=mock
ESIGN_ADAPTER=mock            | docuseal
EXTRACTION_ADAPTER=mock
JUDGE_ADAPTER=mock            | claude
BGCHECK_ADAPTER=mock
ALAYACARE_ADAPTER=mock        | export
ALAYACARE_BASE_URL=http://localhost:4010
TRAINING_ADAPTER=mock
STORAGE_ADAPTER=local
STORAGE_ROOT=./storage
ANTHROPIC_API_KEY             only when JUDGE_ADAPTER=claude
AGENT_ADAPTER=mock            | openai
OPENAI_API_KEY                only when AGENT_ADAPTER=openai
DOCUSEAL_URL, DOCUSEAL_API_KEY, DOCUSEAL_WEBHOOK_SECRET,
DOCUSEAL_ADMIN_EMAIL, DOCUSEAL_ADMIN_PASSWORD   only when ESIGN_ADAPTER=docuseal
```

## Webhooks

Inbound at `src/app/api/webhooks/[provider]/route.ts`. Every handler: verify signature →
persist the raw payload → enqueue a job → return 200 fast. No business logic in the handler.
Mocks sign their payloads with the same scheme so the verification path is exercised in dev.
Between verifying and persisting, the handler resolves the agency from `WebhookSubject`
(provider + vendor id), which the task that created the envelope or order registered. An unknown
id is answered 409 and not stored, so the vendor redelivers.

DocuSeal runs in Docker, so its webhook (Settings > Webhooks) points at
`http://host.docker.internal:3000/api/webhooks/esign`, subscribed to `form.completed` and
`form.declined`, with a custom header `X-Credora-Webhook-Secret` whose value is
`DOCUSEAL_WEBHOOK_SECRET`.
