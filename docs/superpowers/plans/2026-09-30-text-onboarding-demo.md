# Text-Message Onboarding Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caregiver goes from invite to "Ready for AlayaCare" by chatting with an agent on a web phone page, while staff approve documents and complete the background check in the admin portal.

**Architecture:** A deterministic conversation state machine (`src/domain/conversation/`) derives the caregiver's step from their record each turn. A queued `conversation.turn` job asks the `agent` port (a low-cost OpenAI model, or a mock) to turn the caregiver's text into one typed event, applies it through use cases run as the caregiver, and replies with fixed templates. DocuSeal and PaddleOCR slot in behind the existing e-sign and extraction ports.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/Postgres, zod 4, the `openai` SDK (added in Task 5), Vitest (added in Task 3), Docker (DocuSeal, a Python PaddleOCR service).

**Spec:** `docs/superpowers/specs/2026-09-30-sms-onboarding-demo-design.md`. ADRs 162–166 in `docs/context/DECISIONS.md`; `AGENTIC-TASKS.md` entry 2.

## Global Constraints

- Repo rules in `CLAUDE.md` § Hard rules and `docs/context/CONVENTIONS.md` apply to every task: layering (`app → server → domain`; `domain` imports only domain, zod, date-fns), no `any`, no `!`, named exports, kebab-case files, no try/catch that only rethrows or logs, no comments restating code.
- Read `docs/context/NEXTJS-16.md` before writing any page, action or route (await `params`; `PageProps<'/route'>`; actions in `"use server"` files; `revalidatePath` before `redirect`).
- Server actions: authenticate → `runAsPrincipal` → use case (`defineUseCase` authorizes) → revalidate. Every new use case adds its action to `src/server/auth/policy.ts`.
- Every repository function takes `agencyId` first. Multi-step writes use `runInAuditedTransaction`.
- Job handlers use `defineJobHandler`, run their body in `runAsSystem`, and are registered in `src/server/jobs/handlers.ts` (`jobRegistry`).
- New env vars go into `src/lib/env.ts` and `.env.example`; new port slots go into `src/integrations/ports/names.ts` (`PORT_NAMES`, `Ports`) and `src/integrations/registry.ts`. Every `*_ADAPTER` defaults to `mock`.
- Tests: only pure `src/domain/` unit tests, `*.test.ts` beside the file. No DB, UI, route or conversation-eval tests. Run `npx vitest related <changed files> --run`. Every task ends with `npm run build` and `npm run lint` passing.
- Model: OpenAI `gpt-5-mini` with low reasoning effort, through the official `openai` npm SDK and Structured Outputs (a zod schema via the SDK's zod helper; confirm the helper supports zod 4, else pass the JSON schema from `z.toJSONSchema`). Confirm the model id on OpenAI's models page before coding; it lives in one exported constant `OPENAI_MODEL` in `src/integrations/adapters/openai-client.ts`, beside `createOpenAIClient()` (reads `OPENAI_API_KEY`, `maxRetries: 0`). No sampling parameters. Key: `OPENAI_API_KEY`, optional in env, required by the adapter factories.
- Dev-only pages are `*.dev.tsx` under `src/app/dev/` (ADR-011, ADR-040).
- The SSN never appears in plaintext in a `Message` row, a job payload, a prompt or a log.
- Add a `docs/context/MODULES.md` row for every new directory, in the same task.
- Each task commits its own work on `main` with a message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The caregiver sends a correction mid-intake or at the read-back** ("actually my email is x") — expect the field overwritten and the read-back shown again. Covered by the `CONFIRM_INTAKE` `correct` event (Task 6).
2. **Two messages arrive before the first turn finishes** — expect them handled in order against the fresh step, never both against the old one. Covered by the row lock in Task 6.
3. **A photo arrives at a step that is not asking for one, or text arrives while a document is being asked for** — expect "I'll ask for documents after you've signed" / a question answered, never an upload against the wrong requirement. Covered in Task 6.
4. **SSN typed with spaces or dashes, or inside a sentence** — expect it redacted from storage and prompts. Pinned by the redaction test in Task 2.
5. **Staff reply manually while the agent is active** — expect the staff text in the transcript and on the phone, and the agent not to answer staff messages. Covered in Task 3 (staff messages are outbound only).

---

### Task 1: Demo requirement set and invite by phone

Context: `docs/context/MODULES.md` rows 4 (requirements) and "Platform"; `DOMAIN.md` (requirement instance); the invite rows in MODULES reverse index.

**Files:**
- Modify: `src/domain/requirements/vocabulary.ts` (`STATES`, `INTAKE_REQUIREMENT_KEYS`)
- Create: `src/db/seeds/demo-requirement-templates.ts`
- Modify: `src/db/seeds/ny-requirement-templates.ts` (scope PHI ack, emergency contacts, EEOC to NY)
- Modify: `src/db/seeds/alvita.ts` (call the demo seeder)
- Modify: `src/domain/documents/agency-templates.ts` (add `DEMO_INTAKE_FORM`), `src/domain/requirements/vocabulary.ts` `DOCUMENT_KEYS`
- Modify: `src/domain/documents/upload.ts` (`DRIVERS_LICENSE` is PERSONNEL)
- Modify: `src/integrations/adapters/judge/mock.ts` (knows a driver's license)
- Modify: `src/domain/pipeline/invite.ts`, `src/server/caregivers/invite.ts`, `src/db/repositories/invites.ts`, `src/app/(staff)/caregivers/new/{invite-form.tsx,actions.ts}`
- Modify: `src/app/_lib/status.ts` (`SYNCING` label)

**Interfaces:**
- Produces: `STATES = ['NY', 'DEMO']`; `INTAKE_REQUIREMENT_KEYS.TEXT = 'INTAKE_TEXT'`; template keys `DEMO_INTAKE_FORM`, `AIDE_CERTIFICATION`, `TB_TEST`, `PHOTO_ID`; evidence keys `HHA_CERTIFICATE`, `TB_PPD_RESULT`, `DRIVERS_LICENSE`, `INTAKE_TEXT_SUBMITTED`, `DEMO_INTAKE_FORM`.
- Produces: `inviteCaregiverInputSchema` gains `mobilePhone: phoneSchema` (required) and `email` becomes optional (`emailSchema.optional()` after empty-string → undefined). `createInvitedCaregiver` writes `contact.mobilePhone`.
- Produces: `isMobilePhoneInUse(tx, agencyId, mobilePhone): Promise<boolean>` in `src/db/repositories/invites.ts` (ignores WITHDRAWN, like `isEmailInUse`); `inviteCaregiver` result gains `{ ok: false; reason: 'PHONE_IN_USE' }`.

- [ ] **Step 1: Vocabulary.** Add `'DEMO'` to `STATES` and `DEMO: 'Demo'` to the form's `STATE_LABELS`. Add `TEXT: 'INTAKE_TEXT'` to `INTAKE_REQUIREMENT_KEYS` and `DEMO_INTAKE_FORM: 'DEMO_INTAKE_FORM'` to `DOCUMENT_KEYS`.

- [ ] **Step 2: Demo intake form template.** In `AGENCY_TEMPLATES` add a `DEMO_INTAKE_FORM` entry (title "Caregiver intake form") using only existing `DOCUMENT_FIELDS`: a heading, fields `caregiverLegalName`, `caregiverAddress`, `caregiverMobilePhone`, `issuedOn`, and one paragraph: "I confirm the information above is true and complete." Follow the shape of the existing `FCRA_DISCLOSURE` and `EMPLOYMENT_APPLICATION` entries.

- [ ] **Step 3: Demo platform templates.** Create `src/db/seeds/demo-requirement-templates.ts`, modelled on `ny-requirement-templates.ts` (reuse its `PERMANENT`/`YEARLY` shapes and `option` helper by exporting them from that file). Scope `DEMO = { state: 'DEMO' }`. Templates:

```ts
export const DEMO_PLATFORM_TEMPLATES: readonly PublishRequirementTemplateInput[] = [
  {
    ...PERMANENT,
    key: INTAKE_REQUIREMENT_KEYS.TEXT,
    scope: DEMO,
    name: 'Intake by text',
    description: 'Legal name, date of birth, sex, email, home address and SSN, confirmed by text.',
    type: 'FORM',
    acceptedEvidence: [option('ATTESTATION', `${INTAKE_REQUIREMENT_KEYS.TEXT}_SUBMITTED`, 'I confirm my details are correct.')],
  },
  {
    ...PERMANENT,
    key: DOCUMENT_KEYS.DEMO_INTAKE_FORM,
    scope: DEMO,
    name: 'Intake form',
    description: 'The signed caregiver intake form.',
    type: 'FORM',
    acceptedEvidence: [option('SIGNED_DOCUMENT', DOCUMENT_KEYS.DEMO_INTAKE_FORM, 'Signed intake form.')],
  },
  {
    ...PERMANENT,
    key: 'AIDE_CERTIFICATION',
    scope: DEMO,
    name: 'HHA certificate',
    description: 'A home health aide training certificate from a recognized training program or state agency.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'HHA_CERTIFICATE', 'HHA certificate.')],
  },
  {
    ...YEARLY,
    key: 'TB_TEST',
    scope: DEMO,
    name: 'TB test',
    description: 'A tuberculosis PPD skin test result from a licensed clinic.',
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'TB_PPD_RESULT', 'PPD skin test result.')],
  },
  {
    key: 'PHOTO_ID',
    scope: DEMO,
    validityRule: 'FROM_EVIDENCE',
    validityMonths: null,
    renewalRule: 'NONE',
    manualOnlyReason: null,
    name: "Driver's license",
    description: "A current driver's license issued by a US state motor vehicle agency.",
    type: 'DOCUMENT',
    acceptedEvidence: [option('UPLOADED_DOCUMENT', 'DRIVERS_LICENSE', "Driver's license.")],
  },
]

export async function seedDemoPlatformRequirementTemplates(db: CorePrismaClient, now: Date): Promise<number>
// same body as seedNyPlatformRequirementTemplates, with 'DEMO' and DEMO_PLATFORM_TEMPLATES
```

Match the exact field names of `PublishRequirementTemplateInput` and the `renewalRule` values the schema accepts (read `src/domain/requirements/template.ts`). Export `publishAll` from the NY file rather than copying it.

- [ ] **Step 4: Keep the NY-only agency templates off DEMO.** In `NY_AGENCY_DEFAULT_TEMPLATES` change the scope of `PHI_ACKNOWLEDGEMENT`, `EMERGENCY_CONTACTS` and `EEOC_SELF_IDENTIFICATION` from `AGENCY_WIDE` to `{ state: 'NY' }`. Leave `FCRA_DISCLOSURE` and `BACKGROUND_CHECK` agency-wide. Update the block comment above the list to say these three are NY-scoped so the DEMO set stays at seven (ADR-166). Call `seedDemoPlatformRequirementTemplates` from `seedAlvitaReferenceData` in `src/db/seeds/alvita.ts`, beside the NY platform seed.

- [ ] **Step 5: Evidence class and mock judge.** Add `DRIVERS_LICENSE: 'PERSONNEL'` to `UPLOAD_EVIDENCE_CLASSES` in `src/domain/documents/upload.ts`. In `src/integrations/adapters/judge/mock.ts` add a driver's-license entry to `CREDENTIAL_KINDS` matching "DRIVER" / "LICENSE" in the requirement description and "DRIVER LICENSE" / "MOTOR VEHICLES" / "DMV" in the text.

- [ ] **Step 6: Invite with a mobile number.** In `inviteCaregiverInputSchema` add `mobilePhone: phoneSchema` (from `src/domain/validation/phone.ts`) and make `email` optional (an empty form field becomes `undefined`). In `inviteCaregiver`: check `isMobilePhoneInUse` (new, beside `isEmailInUse`, same WITHDRAWN rule) and return `PHONE_IN_USE`; check `isEmailInUse` only when an email is given. `createInvitedCaregiver` writes `contact: { create: { email: input.email ?? null, mobilePhone: input.mobilePhone } }`. Add a "Mobile phone" field to the invite form (`FIELDS`, `invite-form.tsx`) and show the new refusal. The invite email job already cancels with `NO_EMAIL` when there is no email; leave it. In `src/app/_lib/status.ts` change the `SYNCING` label to "Ready for AlayaCare".

- [ ] **Step 7: Verify.** `npm run build && npm run lint`. Then `npm run db:seed`, `npm run dev`, sign in as `admin@alvita.test`, invite a caregiver with work state Demo, service type HHA and a mobile number, and check the caregiver page lists exactly: Intake by text, Intake form, Background check disclosure, HHA certificate, TB test, Driver's license, Background check.

- [ ] **Step 8: Commit.**

```bash
git add -A && git commit -m "Add the DEMO requirement set and invite by mobile number"
```

---

### Task 2: Conversation store, redaction, the text channel and the web phone

Context: MODULES "Platform" row; `DATA-MODEL.md` (storage tiers); `SECURITY.md` (encryption); `INTEGRATIONS.md` § Rules.

**Files:**
- Modify: `prisma/schema.prisma` (+ migration `conversations`)
- Create: `src/domain/conversation/redact.ts`, `src/domain/conversation/redact.test.ts`
- Modify: `package.json` (vitest), create `vitest.config.ts`
- Modify: `src/integrations/ports/messaging.ts`, `src/integrations/adapters/messaging/mock.ts`
- Create: `src/db/repositories/conversations.ts`
- Create: `src/server/conversation/receive.ts`, `src/server/conversation/send.ts`
- Create: `src/app/dev/phone/[caregiverId]/page.dev.tsx`, `src/app/dev/phone/[caregiverId]/phone.tsx`, `src/app/dev/phone/[caregiverId]/actions.ts`
- Modify: `docs/context/MODULES.md`, `docs/context/INTEGRATIONS.md` (messaging row)

**Interfaces:**
- Produces (domain): `redactSsn(text: string): { readonly redacted: string; readonly ssn: string | null }`.
- Produces (port): `MessagingPort.sendText(input: SendTextInput): Promise<SendMessageResult>` with `sendTextInputSchema = z.object({ agencyId: z.uuid(), to: phoneSchema, body: z.string().min(1), idempotencyKey: z.string().min(1) })`.
- Produces (repo, `src/db/repositories/conversations.ts`):
  - `ensureConversation(tx: AuditedTx, agencyId, caregiverId, phone): Promise<ConversationRow>`
  - `lockConversation(tx: AuditedTx, agencyId, caregiverId): Promise<ConversationRow | null>` (`SELECT ... FOR UPDATE` via `tx.$queryRaw`)
  - `updateConversation(tx: AuditedTx, agencyId, conversationId, patch: { awaitingStep?: string | null; unclearCount?: number; pausedAt?: Date | null; optedOutAt?: Date | null }): Promise<void>`
  - `appendMessage(tx: AuditedTx, agencyId, input: { conversationId; direction: 'INBOUND' | 'OUTBOUND'; author: 'CAREGIVER' | 'AGENT' | 'STAFF'; body; ssnEnc?: Uint8Array | null; mediaStorageKey?: string | null }): Promise<{ id: string }>`
  - `listMessages(agencyId, conversationId, limit): Promise<readonly MessageRow[]>` (oldest first, last `limit`)
  - `findLiveCaregiverByPhone(agencyId, phone): Promise<{ caregiverId: string } | null>`
  - `findMessage(agencyId, messageId): Promise<MessageRow | null>`
  - `ConversationRow = { id; caregiverId; phone; awaitingStep: string | null; unclearCount: number; pausedAt: Date | null; optedOutAt: Date | null }`; `MessageRow = { id; direction; author; body; hasSsn: boolean; mediaStorageKey: string | null; createdAt: Date }`
- Produces (server):
  - `receiveText(input: { agencyId: string; from: string; body: string; media: Uint8Array | null }): Promise<{ ok: true } | { ok: false; reason: 'UNKNOWN_NUMBER' | 'EMPTY' }>` in `receive.ts`: runs as system; stores the inbound message and enqueues `conversation.turn` with payload `{ messageId }` (idempotency key `buildIdempotencyKey('conversation.turn', [messageId])`). The job type constant `CONVERSATION_TURN_JOB_TYPE = 'conversation.turn'` is exported from `receive.ts`; the handler arrives in Task 6.
  - `sendAgentText(input: { agencyId; caregiverId; conversationId; phone; body; author: 'AGENT' | 'STAFF'; idempotencyKey }): Promise<void>` in `send.ts`: calls `getPort('messaging').sendText`, then `appendMessage` (OUTBOUND).

- [ ] **Step 1: Add Vitest.** `npm i -D vitest`. Add `"test": "vitest run"` to `package.json`. Create `vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/domain/**/*.test.ts'] },
})
```

- [ ] **Step 2: Write the failing redaction test** `src/domain/conversation/redact.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { redactSsn } from './redact'

describe('redactSsn', () => {
  it('redacts an SSN typed with dashes, spaces or inside a sentence', () => {
    expect(redactSsn('my ssn is 123-45-6789 thanks')).toEqual({ redacted: 'my ssn is [SSN] thanks', ssn: '123456789' })
    expect(redactSsn('123 45 6789')).toEqual({ redacted: '[SSN]', ssn: '123456789' })
    expect(redactSsn('123456789')).toEqual({ redacted: '[SSN]', ssn: '123456789' })
  })

  it('leaves dates, zip codes and phone numbers alone', () => {
    expect(redactSsn('born 03/14/1988, zip 11201, call 7185551234')).toEqual({
      redacted: 'born 03/14/1988, zip 11201, call 7185551234',
      ssn: null,
    })
  })
})
```

- [ ] **Step 3: Run it to see it fail.** `npx vitest related src/domain/conversation/redact.test.ts --run` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/domain/conversation/redact.ts`:

```ts
const SSN_PATTERN = /(?<!\d)(\d{3})[- ]?(\d{2})[- ]?(\d{4})(?!\d)/g

export const SSN_PLACEHOLDER = '[SSN]'

export function redactSsn(text: string): { readonly redacted: string; readonly ssn: string | null } {
  let ssn: string | null = null
  const redacted = text.replace(SSN_PATTERN, (_match, area: string, group: string, serial: string) => {
    ssn ??= `${area}${group}${serial}`
    return SSN_PLACEHOLDER
  })
  return { redacted, ssn }
}
```

A ten-digit phone number is not matched because of the `(?<!\d)`/`(?!\d)` guards. Run the test → PASS.

- [ ] **Step 5: Schema.** Add to `prisma/schema.prisma` (core schema, beside `SentMessage`):

```prisma
enum MessageDirection {
  INBOUND
  OUTBOUND
  @@schema("core")
}

enum MessageAuthor {
  CAREGIVER
  AGENT
  STAFF
  @@schema("core")
}

model Conversation {
  id           String    @id @default(uuid(7))
  agencyId     String
  caregiverId  String
  phone        String
  awaitingStep String?
  unclearCount Int       @default(0)
  pausedAt     DateTime?
  optedOutAt   DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  caregiver Caregiver @relation(fields: [agencyId, caregiverId], references: [agencyId, id], onDelete: Cascade)
  messages  Message[]
  @@unique([agencyId, caregiverId])
  @@unique([agencyId, id])
  @@schema("core")
}

/// @tier sensitive
model Message {
  id              String           @id @default(uuid(7))
  agencyId        String
  conversationId  String
  direction       MessageDirection
  author          MessageAuthor
  body            String
  ssnEnc          Bytes?
  mediaStorageKey String?
  createdAt       DateTime         @default(now())
  conversation Conversation @relation(fields: [agencyId, conversationId], references: [agencyId, id], onDelete: Cascade)
  @@index([agencyId, conversationId, createdAt])
  @@schema("core")
}
```

Add the back-relation `conversation Conversation?` on `Caregiver` and `@@index([agencyId, mobilePhone])` on `ContactRecord`. Run `npm run db:migrate -- --name conversations`. If the retention sweep deletes caregiver rows explicitly by model (check `src/server/retention/`), the cascade covers these tables; note it in the commit if not.

- [ ] **Step 6: Messaging port.** Add `sendTextInputSchema`, `SendTextInput` and `sendText` to `MessagingPort`; replace the "Email only" comment with "Email for staff, text for caregivers (ADR-162)." Export `SendMessageResult`. The mock's `sendText` parses its input and returns `{ status: 'sent', providerMessageId: buildIdempotencyKey('messaging.mock.text', [agencyId, idempotencyKey]) }`; it writes nothing (the conversation stores the `Message`).

- [ ] **Step 7: Repository** `src/db/repositories/conversations.ts` with the functions in Interfaces. `appendMessage` also `touch`es nothing else. `findLiveCaregiverByPhone` reads `ContactRecord` by `(agencyId, mobilePhone)` joined to a caregiver whose stage is not `WITHDRAWN`; more than one match returns `null` (the same rule as the email lookup).

- [ ] **Step 8: `receiveText`** in `src/server/conversation/receive.ts`:
  1. `const { redacted, ssn } = redactSsn(body.trim())`; empty text and no media → `EMPTY`.
  2. `findLiveCaregiverByPhone(agencyId, from)`; none → `UNKNOWN_NUMBER`.
  3. If media: `getPort('storage').write({ agencyId, caregiverId, kind: 'upload', extension }, media)` where the extension comes from `checkUploadBytes(media)` (refused bytes are dropped and the text reads "[unsupported attachment]").
  4. In `runInAuditedTransaction`: `ensureConversation`, `appendMessage` (INBOUND, CAREGIVER, `ssnEnc: ssn === null ? null : encryptField(ssn)` via a `db/mapping` helper, since `crypto.ts` is reachable only from `db/mapping/`; add `toSsnCiphertext(ssn)` there), then `enqueueJobInTransaction` for `conversation.turn`.
  Wrap the whole thing in `runAsSystem`.

- [ ] **Step 9: `sendAgentText`** in `src/server/conversation/send.ts` as in Interfaces.

- [ ] **Step 10: The web phone.** `src/app/dev/phone/[caregiverId]/page.dev.tsx` (server component): load the caregiver's agency, name, mobile number and messages through a dev helper `devPhone(caregiverId)` in `src/server/dev/phone.ts` (the dev tools may read unscoped, as `devOutbox` does). Render `<Phone>` (client component in `phone.tsx`): a 375px phone frame, the caregiver's messages right-aligned in blue bubbles and agent/staff messages left-aligned in grey (staff ones labelled "Team"), links clickable, a text box, an attach-photo button (`accept="image/*,application/pdf"`) and Send. It calls `router.refresh()` every 2 seconds. `actions.ts` exports `sendFromPhone(caregiverId: string, formData: FormData): Promise<void>` which reads the caregiver's agency and number with `devPhone` and calls `receiveText`. Link to the phone from `src/app/dev/page.dev.tsx`.

- [ ] **Step 11: Docs.** MODULES: a new row "— | Caregiver conversation | `src/domain/conversation/`, `src/server/conversation/`, `src/db/repositories/conversations.ts`, `src/app/dev/phone/`". INTEGRATIONS messaging row: "Email for staff; text for caregivers through `sendText` (ADR-162). The mock returns sent; the conversation stores each `Message`, and the dev web phone at `/dev/phone/[caregiverId]` shows them."

- [ ] **Step 12: Verify and commit.** `npx vitest related src/domain/conversation/redact.ts --run`, `npm run build`, `npm run lint`. Manually: open `/dev/phone/<id>` for the Task 1 caregiver, send "hello" and a photo; both appear in the thread and a `conversation.turn` job is queued (it dead-letters as unregistered until Task 6; that is expected).

```bash
git add -A && git commit -m "Add the conversation store, SSN redaction and the web phone"
```

---

### Task 3: Conversations in the admin portal

Context: MODULES row 9 (coordinator dashboard) and the `caregivers/[id]` reverse-index row; `CONVENTIONS.md` § UI (staff app is desktop-first, dense).

**Files:**
- Create: `src/server/conversation/staff.ts`
- Modify: `src/server/auth/policy.ts`
- Create: `src/app/(staff)/conversations/page.tsx`
- Create: `src/app/(staff)/caregivers/[id]/conversation.tsx`, modify `src/app/(staff)/caregivers/[id]/page.tsx`, `src/app/(staff)/caregivers/[id]/actions.ts`
- Modify: `src/app/(staff)/layout.tsx` (nav)
- Modify: `src/db/repositories/conversations.ts` (`listConversations`)

**Interfaces:**
- Consumes: `sendAgentText`, `appendMessage`, `listMessages`, `updateConversation` (Task 2).
- Produces (use cases in `staff.ts`, all policy `'conversation.manage'` with roles `['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN']`, dataClass `'CAREGIVER_RECORD'`):
  - `viewConversation: UseCase<{ caregiverId: string }, { conversationId: string; paused: boolean; handedOff: boolean; messages: readonly MessageRow[] } | null>`
  - `listConversationsForStaff: UseCase<Record<string, never>, readonly ConversationSummary[]>` where `ConversationSummary = { caregiverId; caregiverName; stage: PipelineStage; lastMessage: string; lastMessageAt: Date; paused: boolean; handedOff: boolean }` (`handedOff` = `unclearCount >= 3`).
  - `setConversationPaused: UseCase<{ caregiverId: string; paused: boolean }, void>` — resuming also resets `unclearCount` to 0 and enqueues `conversation.nudge` (Task 7 registers the handler; enqueue it by the exported type constant `CONVERSATION_NUDGE_JOB_TYPE = 'conversation.nudge'`, declared here in `src/server/conversation/nudge-type.ts`, with payload `{ caregiverId, notice: null }`).
  - `sendStaffText: UseCase<{ caregiverId: string; body: string }, void>` — `sendAgentText` with author `STAFF`.

- [ ] **Step 1: Policy.** Add `'conversation.manage': { dataClass: 'CAREGIVER_RECORD', roles: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN'] }`.
- [ ] **Step 2: Use cases and `listConversations(agencyId)`** (one row per conversation with the latest message, newest first).
- [ ] **Step 3: Caregiver page.** Add a "Conversation" card under Requirements: the transcript (same bubble layout as the phone, desktop width, redacted bodies as stored, "photo" chip when `mediaStorageKey` is set), a Pause/Resume button, a "Handed off" badge, and a reply box. Client part in `conversation.tsx` refreshes every 3 seconds. Actions `pauseConversationAction`, `sendStaffTextAction` in the page's `actions.ts`. Add a dev-only "Open phone" link to `/dev/phone/<id>` when `process.env.NODE_ENV !== 'production'`.
- [ ] **Step 4: Conversations list** at `/conversations`: a `DataTable` of `ConversationSummary` (caregiver link, stage label from `PIPELINE_STAGE_PRESENTATION`, last message, time, paused/handed-off badges). Add "Conversations" to the staff nav gated by `can(principal, 'conversation.manage')`. The existing Pipeline board is the list of every caregiver's status; no new status page.
- [ ] **Step 5: Verify and commit.** `npm run build && npm run lint`; manually send from the phone, see it on the caregiver page and `/conversations`; send a staff reply and see it on the phone.

```bash
git add -A && git commit -m "Show conversations in the admin portal with pause and manual reply"
```

---

### Task 4: The conversation state machine, replies and output check

Context: spec § Conversation step; `DOMAIN.md`.

**Files:**
- Create: `src/domain/conversation/step.ts`, `src/domain/conversation/step.test.ts`
- Create: `src/domain/conversation/replies.ts`
- Create: `src/domain/conversation/output-check.ts`, `src/domain/conversation/output-check.test.ts`
- Create: `src/domain/documents/review-outcome.ts` (types only in this task; the function arrives in Task 8)

**Interfaces:**
- Produces (`src/domain/documents/review-outcome.ts`): `export const RETURN_REASONS = ['UNREADABLE', 'EXPIRED', 'NAME_NOT_FOUND', 'DOB_DIFFERS'] as const; export type ReturnReason = (typeof RETURN_REASONS)[number]`.
- Produces (`step.ts`): everything in the code below.
- Produces (`replies.ts`): `promptFor(step: ConversationStep, context: ReplyContext): string`, `noticeFor(notice: ConversationNotice): string`, `ReplyContext`, `ConversationNotice`, `HANDOFF_REPLY`, `WRONG_TIME_FOR_PHOTO`, `FAILURE_REPLY`.
- Produces (`output-check.ts`): `passesOutputCheck(text: string, allowedOrigins: readonly string[]): boolean`, `MAX_REPLY_LENGTH = 480`.

- [ ] **Step 1: Write the failing `step.test.ts`** — one test per row of the step table:

```ts
import { describe, expect, it } from 'vitest'
import { documentState, nextStep, type ConversationSnapshot } from './step'

const base: ConversationSnapshot = {
  stage: 'INTAKE',
  paused: false,
  optedOut: false,
  unclearCount: 0,
  missingFields: [],
  documents: { AIDE_CERTIFICATION: { kind: 'MISSING' }, TB_TEST: { kind: 'MISSING' }, PHOTO_ID: { kind: 'MISSING' } },
}

describe('nextStep', () => {
  it('asks for the first missing intake field in order', () => {
    expect(nextStep({ ...base, stage: 'INVITED', missingFields: ['ssn', 'sex'] })).toEqual({ kind: 'ASK_FIELD', field: 'sex' })
  })
  it('asks to confirm once every field is present', () => {
    expect(nextStep(base)).toEqual({ kind: 'CONFIRM_INTAKE' })
  })
  it('waits for the signature while signing', () => {
    expect(nextStep({ ...base, stage: 'SIGNING' })).toEqual({ kind: 'AWAIT_SIGNATURE' })
  })
  it('asks for documents in order, fixing a returned one first', () => {
    const documents = { ...base.documents, AIDE_CERTIFICATION: { kind: 'UPLOADED' as const } }
    expect(nextStep({ ...base, stage: 'DOCUMENT_REVIEW', documents })).toEqual({ kind: 'REQUEST_DOCUMENT', document: 'TB_TEST' })
    const returned = { ...documents, AIDE_CERTIFICATION: { kind: 'RETURNED' as const, reason: 'EXPIRED' as const } }
    expect(nextStep({ ...base, stage: 'DOCUMENT_REVIEW', documents: returned })).toEqual({ kind: 'FIX_DOCUMENT', document: 'AIDE_CERTIFICATION', reason: 'EXPIRED' })
  })
  it('waits for review once everything is uploaded', () => {
    const documents = { AIDE_CERTIFICATION: { kind: 'APPROVED' as const }, TB_TEST: { kind: 'UPLOADED' as const }, PHOTO_ID: { kind: 'UPLOADED' as const } }
    expect(nextStep({ ...base, stage: 'VERIFICATION', documents })).toEqual({ kind: 'AWAIT_REVIEW' })
  })
  it('is cleared once ready for AlayaCare', () => {
    expect(nextStep({ ...base, stage: 'SYNCING' })).toEqual({ kind: 'CLEARED' })
  })
  it('hands off when paused or after three unclear replies, and stops when withdrawn or opted out', () => {
    expect(nextStep({ ...base, paused: true })).toEqual({ kind: 'HANDED_OFF' })
    expect(nextStep({ ...base, unclearCount: 3 })).toEqual({ kind: 'HANDED_OFF' })
    expect(nextStep({ ...base, stage: 'WITHDRAWN' })).toEqual({ kind: 'STOPPED' })
    expect(nextStep({ ...base, optedOut: true, paused: true })).toEqual({ kind: 'STOPPED' })
  })
})

describe('documentState', () => {
  it('reads a returned or rejected upload as returned, and a staff-bound one as uploaded', () => {
    expect(documentState({ status: 'EXCEPTION', returnReason: 'UNREADABLE', rejectedByStaff: false })).toEqual({ kind: 'RETURNED', reason: 'UNREADABLE' })
    expect(documentState({ status: 'EXCEPTION', returnReason: null, rejectedByStaff: true })).toEqual({ kind: 'RETURNED', reason: 'STAFF_REJECTED' })
    expect(documentState({ status: 'EXCEPTION', returnReason: null, rejectedByStaff: false })).toEqual({ kind: 'UPLOADED' })
    expect(documentState({ status: 'NOT_STARTED', returnReason: null, rejectedByStaff: false })).toEqual({ kind: 'MISSING' })
    expect(documentState({ status: 'SATISFIED', returnReason: null, rejectedByStaff: false })).toEqual({ kind: 'APPROVED' })
  })
})
```

- [ ] **Step 2: Run to see it fail.** `npx vitest related src/domain/conversation/step.test.ts --run` → FAIL.

- [ ] **Step 3: Implement `step.ts`:**

```ts
import type { ReturnReason } from '../documents/review-outcome'
import type { PipelineStage } from '../pipeline/stage'
import type { InstanceStatus } from '../requirements/instance-status'

export const TEXT_INTAKE_FIELDS = ['dateOfBirth', 'sex', 'email', 'address', 'ssn'] as const
export type TextIntakeField = (typeof TEXT_INTAKE_FIELDS)[number]

export const DEMO_DOCUMENTS = ['AIDE_CERTIFICATION', 'TB_TEST', 'PHOTO_ID'] as const
export type DemoDocument = (typeof DEMO_DOCUMENTS)[number]

export type DocumentReturnReason = ReturnReason | 'STAFF_REJECTED'

export type DocumentState =
  | { readonly kind: 'MISSING' }
  | { readonly kind: 'RETURNED'; readonly reason: DocumentReturnReason }
  | { readonly kind: 'UPLOADED' }
  | { readonly kind: 'APPROVED' }

export type ConversationSnapshot = {
  readonly stage: PipelineStage
  readonly paused: boolean
  readonly optedOut: boolean
  readonly unclearCount: number
  readonly missingFields: readonly TextIntakeField[]
  readonly documents: Readonly<Record<DemoDocument, DocumentState>>
}

export type ConversationStep =
  | { readonly kind: 'ASK_FIELD'; readonly field: TextIntakeField }
  | { readonly kind: 'CONFIRM_INTAKE' }
  | { readonly kind: 'AWAIT_SIGNATURE' }
  | { readonly kind: 'REQUEST_DOCUMENT'; readonly document: DemoDocument }
  | { readonly kind: 'FIX_DOCUMENT'; readonly document: DemoDocument; readonly reason: DocumentReturnReason }
  | { readonly kind: 'AWAIT_REVIEW' }
  | { readonly kind: 'CLEARED' }
  | { readonly kind: 'HANDED_OFF' }
  | { readonly kind: 'STOPPED' }

export const MAX_UNCLEAR_REPLIES = 3

export function nextStep(snapshot: ConversationSnapshot): ConversationStep {
  const { stage } = snapshot
  if (stage === 'WITHDRAWN' || snapshot.optedOut) return { kind: 'STOPPED' }
  if (snapshot.paused || snapshot.unclearCount >= MAX_UNCLEAR_REPLIES) return { kind: 'HANDED_OFF' }
  if (stage === 'SYNCING' || stage === 'ACTIVE') return { kind: 'CLEARED' }
  if (stage === 'INVITED' || stage === 'INTAKE') {
    const field = TEXT_INTAKE_FIELDS.find((candidate) => snapshot.missingFields.includes(candidate))
    return field === undefined ? { kind: 'CONFIRM_INTAKE' } : { kind: 'ASK_FIELD', field }
  }
  if (stage === 'SIGNING') return { kind: 'AWAIT_SIGNATURE' }
  for (const document of DEMO_DOCUMENTS) {
    const state = snapshot.documents[document]
    if (state.kind === 'RETURNED') return { kind: 'FIX_DOCUMENT', document, reason: state.reason }
    if (state.kind === 'MISSING') return { kind: 'REQUEST_DOCUMENT', document }
  }
  return { kind: 'AWAIT_REVIEW' }
}

export function documentState(input: {
  readonly status: InstanceStatus
  readonly returnReason: ReturnReason | null
  readonly rejectedByStaff: boolean
}): DocumentState {
  switch (input.status) {
    case 'SATISFIED':
    case 'WAIVED':
      return { kind: 'APPROVED' }
    case 'NOT_STARTED':
    case 'EXPIRED':
      return { kind: 'MISSING' }
    case 'EXCEPTION':
      if (input.returnReason !== null) return { kind: 'RETURNED', reason: input.returnReason }
      if (input.rejectedByStaff) return { kind: 'RETURNED', reason: 'STAFF_REJECTED' }
      return { kind: 'UPLOADED' }
    case 'PENDING':
    case 'IN_REVIEW':
      return { kind: 'UPLOADED' }
  }
}

export function stepKey(step: ConversationStep): string {
  switch (step.kind) {
    case 'ASK_FIELD':
      return `ASK_FIELD:${step.field}`
    case 'REQUEST_DOCUMENT':
    case 'FIX_DOCUMENT':
      return `${step.kind}:${step.document}`
    default:
      return step.kind
  }
}
```

Use the real import paths for `PipelineStage` and `InstanceStatus` (check `src/domain/pipeline/stage.ts`). Run the test → PASS.

- [ ] **Step 4: Replies** `replies.ts` — fixed templates, no model involved:

```ts
import type { ConversationStep, DemoDocument, DocumentReturnReason, TextIntakeField } from './step'

export type IntakeReadBack = {
  readonly legalName: string
  readonly dateOfBirth: string
  readonly sex: string
  readonly email: string
  readonly address: string
  readonly ssnLast4: string
}

export type ReplyContext = {
  readonly firstName: string
  readonly agencyName: string
  readonly signingUrl: string | null
  readonly readBack: IntakeReadBack | null
}

export type ConversationNotice =
  | { readonly kind: 'WELCOME' }
  | { readonly kind: 'SIGNED' }
  | { readonly kind: 'APPROVED'; readonly document: DemoDocument }

export const DOCUMENT_NAMES: Record<DemoDocument, string> = {
  AIDE_CERTIFICATION: 'HHA certificate',
  TB_TEST: 'TB test result',
  PHOTO_ID: "driver's license",
}

const FIELD_PROMPTS: Record<TextIntakeField, string> = {
  dateOfBirth: "What's your date of birth? (for example 03/14/1988)",
  sex: 'What sex is shown on your ID: F, M or X?',
  email: "What's your email address?",
  address: "What's your home address? Street, city, state and ZIP.",
  ssn: "What's your Social Security number? It's stored encrypted and only the last four digits are ever shown.",
}

const RETURN_REASONS: Record<DocumentReturnReason, string> = {
  UNREADABLE: "we couldn't read it. Please send a clearer photo in good light, with the whole document in frame",
  EXPIRED: "it has expired. Please send a current one",
  NAME_NOT_FOUND: "we couldn't find your name on it. Please send one issued in your legal name",
  DOB_DIFFERS: "the date of birth on it doesn't match yours. Please check it's your document",
  STAFF_REJECTED: 'our team could not accept it. Please send a new photo',
}

export const HANDOFF_REPLY = "Thanks. I've passed this to the team and someone will follow up with you soon."
export const WRONG_TIME_FOR_PHOTO = "Thanks! I'll ask for your documents after you've signed your forms."
export const FAILURE_REPLY = 'Sorry, something went wrong. Someone from the team will follow up.'

export function promptFor(step: ConversationStep, context: ReplyContext): string {
  switch (step.kind) {
    case 'ASK_FIELD':
      return FIELD_PROMPTS[step.field]
    case 'CONFIRM_INTAKE': {
      const r = context.readBack
      if (r === null) return 'Please reply YES to confirm your details.'
      return [
        "Here's what I have:",
        `Name: ${r.legalName}`,
        `Date of birth: ${r.dateOfBirth}`,
        `Sex: ${r.sex}`,
        `Email: ${r.email}`,
        `Address: ${r.address}`,
        `SSN: ending ${r.ssnLast4}`,
        'Reply YES if this is right, or tell me what to change.',
      ].join('\n')
    }
    case 'AWAIT_SIGNATURE':
      return context.signingUrl === null
        ? "I'm preparing your forms to sign. I'll text you the link in a moment."
        : `Please review and sign your forms here: ${context.signingUrl}`
    case 'REQUEST_DOCUMENT':
      return `Please send a photo of your ${DOCUMENT_NAMES[step.document]}.`
    case 'FIX_DOCUMENT':
      return `About your ${DOCUMENT_NAMES[step.document]}: ${RETURN_REASONS[step.reason]}.`
    case 'AWAIT_REVIEW':
      return "Thanks, you've sent everything we need. Our team is reviewing it and I'll text you with any news."
    case 'CLEARED':
      return `You're cleared to work with ${context.agencyName}! The team will be in touch about your first shift.`
    case 'HANDED_OFF':
      return HANDOFF_REPLY
    case 'STOPPED':
      return ''
  }
}

export function noticeFor(notice: ConversationNotice, context: ReplyContext): string {
  switch (notice.kind) {
    case 'WELCOME':
      return `Hi ${context.firstName}, this is ${context.agencyName}. I'll help you finish your onboarding by text. You can ask me a question at any time.`
    case 'SIGNED':
      return 'Thanks for signing!'
    case 'APPROVED':
      return `Good news: your ${DOCUMENT_NAMES[notice.document]} was approved.`
  }
}
```

- [ ] **Step 5: Output check, test first.** `output-check.test.ts`:

```ts
import { expect, it } from 'vitest'
import { passesOutputCheck } from './output-check'

const origins = ['http://localhost:3000', 'http://localhost:3001']

it('refuses nine-digit numbers, foreign links and overlong replies', () => {
  expect(passesOutputCheck('Your first shift is Monday.', origins)).toBe(true)
  expect(passesOutputCheck('Sign at http://localhost:3001/s/abc', origins)).toBe(true)
  expect(passesOutputCheck('Your SSN is 123-45-6789', origins)).toBe(false)
  expect(passesOutputCheck('See https://evil.example/x', origins)).toBe(false)
  expect(passesOutputCheck('a'.repeat(481), origins)).toBe(false)
})
```

Implement:

```ts
import { redactSsn } from './redact'

export const MAX_REPLY_LENGTH = 480
const URL_PATTERN = /https?:\/\/[^\s]+/g

export function passesOutputCheck(text: string, allowedOrigins: readonly string[]): boolean {
  if (text.length > MAX_REPLY_LENGTH) return false
  if (redactSsn(text).ssn !== null) return false
  const urls = text.match(URL_PATTERN) ?? []
  return urls.every((url) => allowedOrigins.some((origin) => url.startsWith(`${origin}/`) || url === origin))
}
```

- [ ] **Step 6: Verify and commit.** `npx vitest related src/domain/conversation/step.ts src/domain/conversation/output-check.ts --run`, `npm run build`, `npm run lint`.

```bash
git add -A && git commit -m "Add the conversation state machine, reply templates and output check"
```

---

### Task 5: The agent port (OpenAI and mock)

Context: `AGENTIC-TASKS.md` entry 2; `INTEGRATIONS.md` § Rules; the existing judge adapter `src/integrations/adapters/judge/claude.ts` as the pattern for error mapping to `VendorUnavailableError` and strict parsing. Read the OpenAI Node SDK README for Structured Outputs before coding.

**Files:**
- Create: `src/domain/conversation/events.ts`
- Create: `src/integrations/ports/agent.ts`
- Create: `src/integrations/adapters/openai-client.ts`, `src/integrations/adapters/agent/openai.ts`, `src/integrations/adapters/agent/mock.ts`, `src/integrations/adapters/agent/faq.ts`
- Modify: `package.json` (`npm i openai`)
- Modify: `src/integrations/ports/names.ts`, `src/integrations/registry.ts`, `src/lib/env.ts`, `.env.example`, `docs/context/INTEGRATIONS.md`, `docs/context/MODULES.md`

**Interfaces:**
- Produces (`events.ts`, domain, zod only):

```ts
import { z } from 'zod'
import { TEXT_INTAKE_FIELDS, type ConversationStep } from './step'

const question = z.object({ kind: z.literal('question'), answer: z.string().min(1).nullable() })
const unclear = z.object({ kind: z.literal('unclear') })

const addressAnswer = z.object({ line1: z.string(), line2: z.string().optional(), city: z.string(), state: z.string(), zip: z.string() })

export const agentEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), value: z.union([z.string(), addressAnswer]) }),
  z.object({ kind: z.literal('confirm') }),
  z.object({ kind: z.literal('correct'), field: z.enum([...TEXT_INTAKE_FIELDS, 'legalName']), value: z.union([z.string(), addressAnswer]) }),
  question,
  unclear,
])
export type AgentEvent = z.infer<typeof agentEventSchema>

export type AgentEventKind = AgentEvent['kind']

export function eventKindsFor(step: ConversationStep): readonly AgentEventKind[] {
  switch (step.kind) {
    case 'ASK_FIELD':
      return step.field === 'ssn' ? ['question', 'unclear'] : ['answer', 'question', 'unclear']
    case 'CONFIRM_INTAKE':
      return ['confirm', 'correct', 'question', 'unclear']
    default:
      return ['question', 'unclear']
  }
}
```

- Produces (port `src/integrations/ports/agent.ts`):

```ts
export const agentInputSchema = z.object({
  step: z.string().min(1),            // human-readable description of what was just asked
  allowedEvents: z.array(z.enum(['answer', 'confirm', 'correct', 'question', 'unclear'])).min(1),
  status: z.string().min(1),          // the caregiver's progress in one paragraph
  history: z.array(z.object({ from: z.enum(['caregiver', 'agent']), text: z.string() })),
  text: z.string(),                   // the caregiver's latest message, SSN already redacted
})
export type AgentInput = z.infer<typeof agentInputSchema>
export interface AgentPort {
  interpret(input: AgentInput): Promise<AgentEvent>
}
```

The port file imports `agentEventSchema`/`AgentEvent` from the domain. An adapter whose result fails `agentEventSchema`, or returns a kind not in `allowedEvents`, returns `{ kind: 'unclear' }`.

- [ ] **Step 1: `events.ts`** as above.
- [ ] **Step 2: Port file**, `PORT_NAMES` + `Ports` entry `agent`, registry slot `agent: { variable: 'AGENT_ADAPTER', selected: env.AGENT_ADAPTER, adapters: { mock: () => createMockAgent(), openai: () => createOpenAIAgent() } }`, env `AGENT_ADAPTER: z.string().min(1).default('mock')` and `OPENAI_API_KEY: z.string().min(1).optional()`, `.env.example` lines `AGENT_ADAPTER=mock   # | openai (needs OPENAI_API_KEY)` and `OPENAI_API_KEY=`.
- [ ] **Step 3: FAQ** `faq.ts`: `export const AGENT_FAQ` — a short string of Q&A the owner can edit: what the process is (details, sign, three documents, review, background check), how long review takes ("usually one to two business days"), that SSN is encrypted, that photos should be well lit and show the whole document, who to call ("reply HELP and the team will reach out"). Mark it `// Demo copy; the agency owns the final wording.`
- [ ] **Step 4: OpenAI adapter** `createOpenAIAgent(client = createOpenAIClient()): AgentPort` in `agent/openai.ts`; `openai-client.ts` holds `OPENAI_MODEL` and `createOpenAIClient()` (throws a clear error when `OPENAI_API_KEY` is missing, as the claude judge factory does for its key). One Responses API call (`client.responses.parse`) with `model: OPENAI_MODEL`, `reasoning: { effort: 'low' }`, Structured Outputs from `agentEventSchema`, no sampling parameters. System prompt: "You read one text message from a home care job applicant and return exactly one event. Allowed events: {allowedEvents}. `answer` gives the value just asked for (dates as YYYY-MM-DD, sex as F/M/X, address as parts). `confirm` means they agree the details are right. `correct` names the field to change and its new value. `question` is anything they ask; answer it in at most two short sentences using only the FAQ and their status, or null if the FAQ does not cover it. `unclear` for anything else. Never invent facts." Then the FAQ, the status, the step and the history. Map rate-limit, 5xx and connection errors (`OpenAI.RateLimitError`, `OpenAI.InternalServerError`, `OpenAI.APIConnectionError`) to `VendorUnavailableError` as `judge/claude.ts` does for Anthropic's; a refusal, incomplete response or parse failure returns `unclear`.
- [ ] **Step 5: Mock adapter** `createMockAgent(): AgentPort` — deterministic: text ending in `?` → `question` with `answer: null`; `yes|y|yes it is|correct|that's right` (case-insensitive) → `confirm` when allowed; when `answer` is allowed: a numeric date → ISO `answer`; `f|m|x|female|male` → `answer` F/M/X; an email → `answer`; a line of the form `street, city, ST 12345` → address `answer`; otherwise `unclear`.
- [ ] **Step 6: Docs.** INTEGRATIONS: add the `agent` port row ("OpenAI `gpt-5-mini` | Deterministic parser for dates, F/M/X, emails, addresses, yes; `?` is a question with no answer | `AGENT_ADAPTER`") and `AGENT_ADAPTER=mock | openai`, `OPENAI_API_KEY` in the env list. MODULES: add `src/integrations/adapters/agent/` to the conversation row.
- [ ] **Step 7: Verify and commit.** `npm run build && npm run lint`.

```bash
git add -A && git commit -m "Add the agent port with OpenAI and mock adapters"
```

---

### Task 6: The conversation turn and intake by text

Context: spec § A turn; MODULES row 1 (intake) and row 2 (`src/server/forms/signing.ts`); `DATA-MODEL.md` (identity/contact columns, SSN columns); `src/server/dev/demo-seed.ts` `actAsCaregiver` for running as the caregiver.

**Files:**
- Create: `src/db/repositories/conversation-snapshot.ts`
- Create: `src/db/repositories/text-intake.ts`
- Create: `src/server/intake/text-intake.ts`
- Create: `src/server/conversation/turn-job.ts`, `src/server/conversation/context.ts`
- Modify: `src/server/auth/policy.ts` (nothing new if the intake use cases reuse `'caregiver.editOwn'`), `src/server/jobs/handlers.ts`

**Interfaces:**
- Consumes: Task 2 repo and `sendAgentText`; Task 4 `nextStep`, `documentState`, `stepKey`, `promptFor`, `passesOutputCheck`, `HANDOFF_REPLY`, `WRONG_TIME_FOR_PHOTO`, `FAILURE_REPLY`; Task 5 `eventKindsFor`, `getPort('agent')`.
- Produces:
  - `findConversationSnapshot(agencyId, caregiverId): Promise<{ snapshot: ConversationSnapshot; context: ReplyContext; documentInstances: Readonly<Record<DemoDocument, { instanceId: string; evidenceKey: string }>> } | null>` in `conversation-snapshot.ts`. `missingFields` from identity (`dateOfBirth`, `sex`, `ssnLast4`) and contact (`email`, `line1`); `documents` via `documentState` from each demo instance's status, the latest upload's review decision `returnReason` (Task 8 adds the column; until then pass `null`), and whether the latest staff decision for that instance is `REJECTED`/`REUPLOAD_REQUESTED` and newer than the latest upload; `signingUrl` from the latest envelope; `readBack` from the identity/contact columns (DOB as MM/DD/YYYY, address one line, `ssnLast4`).
  - `saveTextIntakeField: UseCase<{ caregiverId: string; field: TextIntakeField | 'legalName'; value: unknown; ssnMessageId?: string }, { ok: true } | { ok: false; reason: 'INVALID' | 'EMAIL_IN_USE' }>` (`'caregiver.editOwn'`), in `src/server/intake/text-intake.ts`. Validates with `dateOfBirthSchema(new Date())`, `z.enum(SEX_MARKERS)`, `emailSchema`, `addressSchema`, `personNameSchema` (legalName "First Last" split on the last space), and for `ssn` decrypts the message's `ssnEnc` and validates with `ssnSchema`. Writes through `writeTextIntakeField(tx, agencyId, caregiverId, field, value)` in `src/db/repositories/text-intake.ts`, reusing the column mapping `columnsFor` / `toSsnColumns` / the address and date-only mappers that `caregiver-record.ts` uses. Email uses `isEmailInUse`. The first save applies `INTAKE_STARTED` (ignore refusals, as `saveIntakeStep` does).
  - `confirmTextIntake: UseCase<{ caregiverId: string; storage: StoragePort }, SendDocumentSetResult>` (`'caregiver.editOwn'`): in one transaction creates the attestation and links `INTAKE_TEXT_SUBMITTED` evidence and moves the `INTAKE_TEXT` instance to `SATISFIED` (the same three calls `saveIntakeStep` makes: `createAttestation`, `linkEvidence`, status change), then calls `sendOwnDocumentSet({ caregiverId, storage })`.
  - `CONVERSATION_TURN_JOB_TYPE` handler `conversationTurnJob` (payload `{ messageId: z.uuid() }`).

- [ ] **Step 1: Snapshot repository.** Implement `findConversationSnapshot`. It is the only reader the turn and nudge use.

- [ ] **Step 2: Text intake use cases.** Implement `saveTextIntakeField`, `writeTextIntakeField`, `confirmTextIntake`. The SSN plaintext exists only inside `saveTextIntakeField`, between decrypting the message's `ssnEnc` (add `readMessageSsn(tx, agencyId, messageId)` to `src/db/mapping/`, the only place `decryptField` is reachable) and writing `toSsnColumns`.

- [ ] **Step 3: Turn job** `src/server/conversation/turn-job.ts`. Body, in `runAsSystem`:

```
load message (findMessage); inbound only
in runInAuditedTransaction:
  conv = lockConversation(...)          // serialises turns per caregiver
  snap = findConversationSnapshot(...)  // read inside the lock
if text.trim().toUpperCase() === 'STOP': updateConversation(optedOutAt: now); reply "You won't get more texts from us. Reply START to resume." and return ok
step = nextStep(snap.snapshot)
if step is STOPPED or HANDED_OFF: return ok (staff see the message; the agent stays silent)
if message has media:
  if step is REQUEST_DOCUMENT or FIX_DOCUMENT:
     run as caregiver: uploadOwnDocument({ caregiverId, instanceId, evidenceKey, bytes: storage.read(key), storage })
     reply "Got it, thanks." followed by promptFor(nextStep(fresh snapshot)) — the next document, or AWAIT_REVIEW
     (a returned document is texted later by the nudge from the review job)
  else reply WRONG_TIME_FOR_PHOTO
  return ok
event =
  step is ASK_FIELD(ssn) and message.hasSsn ? { kind: 'answer', value: '[SSN]' }
  : await getPort('agent').interpret({ step: promptFor(step, ctx), allowedEvents: eventKindsFor(step), status: statusLine(snap), history: last 8 messages, text: message.body })
applied = apply(event, step)   // run as the caregiver (caregiverPrincipalFrom + runAsPrincipal)
  answer        → saveTextIntakeField(step.field, event.value, ssnMessageId?)   ; INVALID/EMAIL_IN_USE → unclear
  correct       → saveTextIntakeField(event.field, event.value)                ; fails → unclear
  confirm       → confirmTextIntake                                           ; not ok → handoff
  question      → answer text (or HANDOFF_REPLY when null / fails passesOutputCheck); step unchanged
  unclear       → unclear
unclearCount = applied is unclear ? conv.unclearCount + 1 : 0
fresh = findConversationSnapshot(...) with the new unclearCount; next = nextStep(fresh)
reply = question answer, then (unless question) promptFor(next, ctx); an unclear reply prefixes "Sorry, I didn't catch that. "
updateConversation(awaitingStep: stepKey(next), unclearCount); if next is HANDED_OFF and was not before: reply HANDOFF_REPLY
sendAgentText(... idempotencyKey: buildIdempotencyKey('conversation.reply', [messageId, part]))
```

`statusLine(snap)` (in `src/server/conversation/context.ts`) turns the snapshot into one sentence per stage for the model ("Details: complete. Forms: signed. HHA certificate: approved. TB test: waiting for review..."). The allowed origins for `passesOutputCheck` are `env.APP_URL` and `env.DOCUSEAL_URL` when set (Task 10 adds it; read it optionally).

On the job's final attempt (`context.attempt === maxAttempts`) a thrown model error sends `FAILURE_REPLY` and sets `pausedAt`; earlier attempts rethrow to retry. Give the handler `maxAttempts: 3` so a demo does not wait minutes.

- [ ] **Step 4: Register** `conversationTurnJob` in `jobRegistry`.

- [ ] **Step 5: Verify and commit.** `npm run build && npm run lint`. Manual run with `npm run dev` + `npm run worker` and `AGENT_ADAPTER=mock`: on the phone send "03/14/1988", "F", an email, "12 Main St, Brooklyn, NY 11201", "123-45-6789", then "yes"; the read-back shows `SSN: ending 6789`, the caregiver moves to Signing, and the transcript on the staff page shows `[SSN]`, never the digits. Then, **once the owner has put `OPENAI_API_KEY` in `.env` (ask them at this step)**, repeat with `AGENT_ADAPTER=openai` and free-form replies ("i was born march 14 88"), a question ("how long does this take?"), and a correction at the read-back.

```bash
git add -A && git commit -m "Run conversation turns: interpret, apply intake by text, reply"
```

---

### Task 7: Nudges and status texts

Context: spec § Texts not caused by a reply; the job sites listed below (MODULES rows 2, 3).

**Files:**
- Create: `src/server/conversation/nudge-job.ts`
- Modify: `src/server/caregivers/invite.ts`, `src/server/forms/send-envelope-job.ts`, `src/server/forms/esign-webhook-job.ts`, `src/server/review/auto-accept-job.ts`, `src/server/review/exception-resolution.ts`, `src/server/jobs/handlers.ts`
- Delete the caregiver-notice email path only if nothing else uses it: leave `caregiverNoticeJob` in place (staff decision emails still go to caregivers who have email), and add the nudge beside it.

**Interfaces:**
- Consumes: `CONVERSATION_NUDGE_JOB_TYPE` (Task 3), `findConversationSnapshot`, `promptFor`, `noticeFor`, `sendAgentText`, `ensureConversation`.
- Produces: `conversationNudgeJob` with payload `{ caregiverId: z.uuid(), notice: z.string().nullable() }` where `notice` is `'WELCOME' | 'SIGNED' | 'APPROVED:<DemoDocument>' | null`; and `enqueueNudge(tx: AuditedTx, agencyId: string, caregiverId: string, notice: string | null, cause: string): Promise<void>` exported from `nudge-job.ts`, using `enqueueJobInTransaction` with key `buildIdempotencyKey(CONVERSATION_NUDGE_JOB_TYPE, [caregiverId, cause])`.

- [ ] **Step 1: The job.** In `runAsSystem`: load the snapshot; skip if the caregiver has no mobile number, or the step is `STOPPED`/`HANDED_OFF`; `ensureConversation`; send `noticeFor(notice)` (when present) and `promptFor(step)` as one message joined by a blank line; `updateConversation(awaitingStep)`. Skip the prompt when the step key equals the conversation's `awaitingStep` and there is no notice (nothing new to say).
- [ ] **Step 2: Enqueue sites** (each inside the transaction that caused it; `cause` is the id that makes it unique):
  - `inviteCaregiver` → `'WELCOME'`, cause `invite:<inviteId>`.
  - `sendEnvelopeJob` after `recordEnvelopeSent` → `null`, cause `envelope-sent:<envelopeId>` (the step's prompt carries the link).
  - `esignWebhookJob` after `ENVELOPE_COMPLETED` → `'SIGNED'`, cause `envelope-signed:<envelopeId>`.
  - A returned document (wired in Task 8, which introduces the RETURN outcome) → `null`, cause `returned:<uploadedDocumentId>`.
  - `decideFlaggedDocument`: ACCEPTED → `'APPROVED:<templateKey>'` when the key is a `DemoDocument`, else `null`; REJECTED/REUPLOAD_REQUESTED → `null`; cause `decision:<staffDecisionId>`.
  - Clearance (wired in Task 9) → `null`, cause `cleared:<caregiverId>`.
- [ ] **Step 3: Register** the handler. **Verify and commit.** `npm run build && npm run lint`; manually: a new invite texts the welcome and the DOB question; after "yes" the signing link arrives once the worker sends the envelope.

```bash
git add -A && git commit -m "Text the caregiver on invite, signing, returns, approvals and clearance"
```

---

### Task 8: Review outcome: return to the caregiver or send to staff

Context: ADR-164; MODULES rows 3 and the `auto-accept.ts` / `exception-queue` reverse-index rows; `src/domain/documents/judge-review.ts` (`JUDGE_STAFF_REASONS` includes `EXPIRED`).

**Files:**
- Modify: `src/domain/documents/review-outcome.ts` (add the function), create `src/domain/documents/review-outcome.test.ts`
- Modify: `src/domain/documents/auto-accept.ts` (delete `autoAcceptOutcome` and `AutoAcceptOutcome`; keep `unconfidentReadings` and the staff reason list; `AutoAcceptDecision.outcome` becomes `ReviewOutcome`)
- Modify: `prisma/schema.prisma` (`returnReason String?` on the auto-accept decision model) + migration `review_return_reason`
- Modify: `src/db/repositories/auto-accept-decisions.ts`, `src/server/review/auto-accept-job.ts`, `src/domain/documents/exception-queue.ts`, `src/server/review/exception-queue.ts`, `src/app/(staff)/queue/page.tsx`, `src/db/repositories/conversation-snapshot.ts` (read `returnReason`)
- Modify: `docs/context/MODULES.md` (row 3 lists `review-outcome.ts`)

**Interfaces:**
- Produces:

```ts
export type ReviewOutcome =
  | { readonly kind: 'RETURN'; readonly reason: ReturnReason }
  | { readonly kind: 'STAFF'; readonly reasons: readonly AutoAcceptStaffReason[] }

export const READABLE_MIN_CONFIDENCE = 0.5

export function reviewOutcome(input: {
  readonly requirement: Pick<RequirementTemplate, 'manualOnly' | 'manualOnlyReason'>
  readonly extraction: Pick<DocumentExtraction, 'confidence' | 'fields'>
  readonly identity: IdentityMatch
  readonly judge: JudgeStepOutcome | null
}): ReviewOutcome
```

- [ ] **Step 1: Failing test** `review-outcome.test.ts`: one case per return reason and one staff case. Build `identity` as `{ matched, findings: [{ field: 'fullName', outcome }, { field: 'dateOfBirth', outcome }] }` and `judge` as `{ kind: 'STAFF', reasons: ['EXPIRED'] }` / `{ kind: 'PASS' }`:
  - confidence 0.3 → `RETURN UNREADABLE`
  - judge STAFF with `EXPIRED` → `RETURN EXPIRED`
  - fullName `DIFFERS` → `RETURN NAME_NOT_FOUND`; fullName `UNREADABLE` → `RETURN NAME_NOT_FOUND`
  - fullName `AGREES`, dateOfBirth `DIFFERS` → `RETURN DOB_DIFFERS`
  - everything passes → `{ kind: 'STAFF', reasons: [] }`; judge `VERDICT_UNCERTAIN` → `{ kind: 'STAFF', reasons: ['JUDGE_NOT_PASSED'] }`
- [ ] **Step 2: Run to fail**, then implement: the checks in that order (unreadable, expired, name, DOB), then the existing staff-reason computation from `autoAcceptOutcome` returning `STAFF` (possibly with no reasons). Run → PASS.
- [ ] **Step 3: Job and storage.** `saveAutoAcceptDecision` stores `returnReason` (null for STAFF) and `staffReasons`. In `autoAcceptDocumentJob` both outcomes move the instance `PENDING → IN_REVIEW → EXCEPTION`; a RETURN enqueues the nudge (Task 7). Nothing sets `SATISFIED` here any more, so drop the `applyDocumentReviewCleared` call from this job. Replace the file's opening comment to cite ADR-164.
- [ ] **Step 4: Queue.** "Needs a decision" lists decisions with outcome `STAFF`; a RETURN is listed under "Waiting on the caregiver" and is not decidable (`isDecidable` requires a STAFF decision). A STAFF item with no reasons shows "All automatic checks passed" in "What failed". Show the name/DOB outcomes and judge reasoning as today.
- [ ] **Step 5: Snapshot.** `findConversationSnapshot` reads the latest upload's `returnReason`.
- [ ] **Step 6: Verify and commit.** `npx vitest related src/domain/documents/review-outcome.ts --run`, `npm run build`, `npm run lint`. Manually with the mock extraction: send `src/integrations/adapters/extraction/fixtures/hha-certificate.pdf` from the phone for a caregiver invited as "Maria Santos" → it lands in "Needs a decision"; send it for a caregiver with another name → returned with "we couldn't find your name on it".

```bash
git add -A && git commit -m "Never auto-accept documents; return fixable failures to the caregiver"
```

---

### Task 9: "Background check completed" and Ready for AlayaCare

Context: ADR-166; MODULES rows 5 and 7; `src/server/review/manual-checks.ts` and the CLEARED_AFTER_REVIEW branch of `adjudicateBackgroundCheck` (the steps to copy); `src/server/clearance/sign-off.ts`.

**Files:**
- Create: `src/server/verification/complete-background-check.ts`
- Modify: `src/server/auth/policy.ts`, `src/app/(staff)/caregivers/[id]/page.tsx`, `src/app/(staff)/caregivers/[id]/actions.ts`, create `src/app/(staff)/caregivers/[id]/complete-background-check.tsx`
- Modify: `src/db/repositories/caregiver-detail.ts` if the page needs `workState` or the FCRA flag

**Interfaces:**
- Produces: `completeBackgroundCheck: UseCase<{ caregiverId: string }, { ok: true } | { ok: false; reason: 'NOT_DEMO' | 'NOT_READY' | 'FCRA_NOT_SIGNED' }>` with policy `'backgroundCheck.complete': { dataClass: 'CLEARANCE', roles: ['COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN'] }`.

- [ ] **Step 1: Use case.** In one `runInAuditedTransaction`:
  1. Refuse `NOT_DEMO` unless `caregiver.workState === 'DEMO'`; `NOT_READY` unless the stage is `VERIFICATION`; `FCRA_NOT_SIGNED` unless `fcraConsentOnFile(signedDocuments)`.
  2. `createCheckResult(agencyId, caregiverId, principal.id)`, `linkEvidence(agencyId, instanceId, BACKGROUND_CHECK_RESULT_EVIDENCE_KEY, { kind: 'CHECK_RESULT', checkResultId })`, step the `BACKGROUND_CHECK` instance to `SATISFIED` along `manualCheckPath(status).steps`.
  3. `applyVerificationCompleted(tx, agencyId, caregiverId, principal.id)` (→ `CLEARANCE`).
  4. `applyPipelineTransition(tx, agencyId, { caregiverId, event: 'CLEARANCE_GRANTED', actorUserId: principal.id })` (→ `SYNCING`, shown as Ready for AlayaCare), `recordCaregiverCredentials` as `signOffClearance` does, and a `SIGN_OFF` audit entry. Do **not** enqueue the AlayaCare sync. Comment: `// ADR-166: the demo stops at Ready for AlayaCare; no sync is enqueued.`
  5. `enqueueNudge(tx, agencyId, caregiverId, null, \`cleared:${caregiverId}\`)`.
- [ ] **Step 2: Button.** On the caregiver page, for DEMO caregivers in `VERIFICATION`, a "Background check completed" button (confirm dialog: "This records the background check as clear and marks the caregiver ready for AlayaCare.") posting `completeBackgroundCheckAction`. Show the refusal as an `Alert`.
- [ ] **Step 3: Verify and commit.** `npm run build && npm run lint`; manually approve all three documents in `/queue`, click the button, see "Ready for AlayaCare" on the pipeline board and "You're cleared" on the phone.

```bash
git add -A && git commit -m "Let staff complete the demo background check and clear the caregiver"
```

---

### Task 10: DocuSeal e-sign adapter

Context: `INTEGRATIONS.md` (esign row, webhooks); the esign port and `src/integrations/adapters/esign/mock.ts`; `src/server/forms/send-envelope-job.ts`, `esign-webhook-job.ts`. Read DocuSeal's API docs (https://www.docuseal.com/docs/api) for: creating a template from PDFs (`POST /api/templates/pdf`), creating a submission with `send_email: false` (`POST /api/submissions`), reading a submission (`GET /api/submissions/{id}`), and webhook setup and its secret header. Confirm each call against the docs before coding; record any difference in the adapter's header comment.

**Files:**
- Modify: `docker-compose.yml` (service `docuseal`, image `docuseal/docuseal`, port `3001:3000`, a named volume)
- Create: `src/integrations/adapters/esign/docuseal.ts`
- Modify: `src/integrations/registry.ts` (esign `docuseal: () => createDocusealEsign({ storage: getPort('storage') })`), `src/lib/env.ts`, `.env.example` (`DOCUSEAL_URL`, `DOCUSEAL_API_KEY`, `DOCUSEAL_WEBHOOK_SECRET`), `docs/context/INTEGRATIONS.md`

**Interfaces:**
- Produces: `createDocusealEsign(deps: { storage: StoragePort }): EsignPort`.
  - `createEnvelope`: reads each `unsignedPdfKey` through storage, creates one template from all the PDFs (base64) with a signature field on each document's last page for role "Caregiver", creates a submission (`send_email: false`, the caregiver as the one submitter), and returns `{ envelopeId: String(submission.id), status: 'sent', signingUrl: \`${DOCUSEAL_URL}/s/${submitter.slug}\`, documents: each with signedPdfKey null, signedAt: null }`. Idempotency: store nothing; DocuSeal has no idempotency key, so look up an existing submission first by `external_id` = the input `idempotencyKey` (`GET /api/submissions?external_id=`) and return it when present.
  - `getEnvelope`: `GET /api/submissions/{id}`; when completed, download each signed document URL and `storage.write({ kind: 'signed', ... })`, mapping them back to `documentRef` by order.
  - `verifyWebhook`: compare the configured secret header with `DOCUSEAL_WEBHOOK_SECRET` (timing-safe); map `form.completed` / `submission.completed` to `{ envelopeId, status: 'signed', occurredAt }`.
  - `voidEnvelope`: `DELETE /api/submissions/{id}` (archive).
  - Transport errors and 5xx → `VendorUnavailableError`.

- [ ] **Step 1: Compose service** and env vars (`ESIGN_ADAPTER=mock | docuseal`).
- [ ] **Step 2: Adapter** as above, following the port contract comment in `src/integrations/ports/messaging.ts` (parse inputs first, transient failures throw `VendorUnavailableError`).
- [ ] **Step 3: Webhook reachability.** DocuSeal runs in Docker, so the webhook URL configured in DocuSeal's settings is `http://host.docker.internal:3000/api/webhooks/esign` with the secret header. Document this in the runbook (Task 12).
- [ ] **Step 4: Verify and commit.** `npm run build && npm run lint`; `docker compose up -d docuseal`, create the admin account and API key at `http://localhost:3001`, set `ESIGN_ADAPTER=docuseal`, run a caregiver through intake on the phone, open the link, sign, and see the caregiver move to Document review and the phone ask for the HHA certificate.

```bash
git add -A && git commit -m "Add the DocuSeal e-sign adapter"
```

---

### Task 11: PaddleOCR service, OCR field finder, judge on OpenAI

Context: `AGENTIC-TASKS.md` entry 1; the extraction port and `src/server/documents/extraction-job.ts`; `src/domain/documents/extraction.ts` (`normaliseFields`, its date parser); `src/domain/identity/match.ts`.

**Files:**
- Create: `services/ocr/Dockerfile`, `services/ocr/app.py`, `services/ocr/requirements.txt`
- Modify: `docker-compose.yml` (service `ocr`, port `8866:8866`)
- Create: `src/integrations/adapters/extraction/paddleocr.ts`
- Create: `src/domain/documents/ocr-fields.ts`, `src/domain/documents/ocr-fields.test.ts`
- Modify: `src/domain/documents/extraction.ts` (export `parseDocumentDate`)
- Modify: `src/server/documents/extraction-job.ts`, `src/integrations/registry.ts`, `src/lib/env.ts`, `.env.example` (`OCR_URL`), create `src/integrations/adapters/judge/openai.ts`, `docs/context/INTEGRATIONS.md`, `docs/context/MODULES.md` (`services/ocr/`)

**Interfaces:**
- Produces (service): `POST /ocr` with the raw image bytes → `{ "lines": [{ "text": string, "confidence": number }] }`. PDFs are rasterised page by page (`pdf2image`) before OCR.
- Produces (adapter): `createPaddleOcrExtraction(deps: { storage: StoragePort }): ExtractionPort` returning `{ fields: [], text: lines.map(l => l.text).join('\n'), confidence: mean line confidence (0 when no lines) }`; connection errors → `VendorUnavailableError`.
- Produces (domain): `findKnownFields(lines: readonly OcrLine[], known: { readonly legalName: PersonName; readonly dateOfBirth: string | null }): readonly FoundField[]` where `OcrLine = { text: string; confidence: number }` and `FoundField = { name: 'fullName' | 'dateOfBirth' | 'issueDate' | 'expiryDate' | 'completionDate'; value: string; confidence: number }`.
- Consumes in the job: when `result.fields` is empty and `result.text` is not, split `text` on newlines into lines (confidence = `result.confidence`), load `findIntakeIdentity`, and pass `findKnownFields(...)` as the fields to `saveExtraction`.

- [ ] **Step 1: Failing test** `ocr-fields.test.ts` using the text of a real HHA certificate and license layout:

```ts
import { expect, it } from 'vitest'
import { findKnownFields } from './ocr-fields'

const known = { legalName: { first: 'Maria', last: 'Santos' }, dateOfBirth: '1988-03-14' }
const line = (text: string) => ({ text, confidence: 0.95 })

it('finds the name despite an OCR slip, the DOB, and labelled dates', () => {
  const fields = findKnownFields(
    [line('NEW YORK STATE'), line('SANTOS, MARlA ELENA'), line('DOB 03/14/1988'), line('ISS 01/10/2025'), line('EXP 03/14/2029')],
    known,
  )
  expect(fields).toEqual(
    expect.arrayContaining([
      { name: 'fullName', value: 'SANTOS, MARlA ELENA', confidence: 0.95 },
      { name: 'dateOfBirth', value: '1988-03-14', confidence: 0.95 },
      { name: 'issueDate', value: '2025-01-10', confidence: 0.95 },
      { name: 'expiryDate', value: '2029-03-14', confidence: 0.95 },
    ]),
  )
})

it('reports no name when the caregiver is not on the document', () => {
  const fields = findKnownFields([line('JOHN DOE'), line('Completed September 15, 2023')], known)
  expect(fields.find((f) => f.name === 'fullName')).toBeUndefined()
  expect(fields).toContainEqual({ name: 'completionDate', value: '2023-09-15', confidence: 0.95 })
})
```

- [ ] **Step 2: Run to fail**, then implement `ocr-fields.ts`:
  - Name: normalise each line (upper case, letters and spaces only); a line matches when it contains a token within edit distance 1 of the first name and a token within edit distance 1 of the last name (names of four letters or fewer must match exactly). The field value is the original line text.
  - Dates: scan each line for date substrings (`\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`, `[A-Za-z]+\.? \d{1,2},? \d{4}`, ISO) and parse with `parseDocumentDate`. A date equal to `known.dateOfBirth` → `dateOfBirth`. Otherwise by the line's label: `/\bexp/i` → `expiryDate`; `/\b(iss|issued|date of test|read|administered)/i` → `issueDate`; `/\b(complet|awarded)/i` → `completionDate`. Unlabelled dates are ignored.
  - Confidence is the line's confidence.
  Run → PASS.
- [ ] **Step 3: OCR service.** `app.py` (FastAPI + `paddleocr` CPU, English model, loaded once at startup), `requirements.txt` (`fastapi`, `uvicorn`, `paddleocr`, `paddlepaddle`, `pdf2image`, `python-multipart`), `Dockerfile` (python:3.11-slim, `apt-get install -y poppler-utils libgl1 libglib2.0-0`, pre-download the models during build so the first request is fast). Compose service `ocr`.
- [ ] **Step 4: Adapter, registry slot** `paddleocr`, env `OCR_URL` (default `http://localhost:8866`), and the extraction-job wiring above.
- [ ] **Step 5: Judge on OpenAI.** Add `createOpenAIJudge(client = createOpenAIClient()): JudgePort` in `judge/openai.ts`, a port of `judge/claude.ts` to the Responses API: the same `JUDGE_CRITERIA`, the same `{quote, finding}` response schema and the same rule that an unquotable quote, refusal or parse failure is `UNCERTAIN`; `modelVersion` is the response's `model`. Register it as `openai` in the judge slot. Leave the claude adapter in place. Cite ADR-165.
- [ ] **Step 6: Verify and commit.** `npx vitest related src/domain/documents/ocr-fields.ts --run`, `npm run build`, `npm run lint`; `docker compose up -d ocr`, `EXTRACTION_ADAPTER=paddleocr JUDGE_ADAPTER=openai`, send a phone photo of a real certificate from the web phone and see its check results in `/queue`.

```bash
git add -A && git commit -m "Add the PaddleOCR service and OCR field finder; add the OpenAI judge"
```

---

### Task 12: Demo runbook and finish

**Files:**
- Create: `docs/DEMO-RUNBOOK.md`
- Modify: `docs/PROGRESS.md`, `docs/OPEN-QUESTIONS.md`

- [ ] **Step 1: Runbook.** Exact commands and settings: `.env` values (`AGENT_ADAPTER=openai`, `JUDGE_ADAPTER=openai`, `ESIGN_ADAPTER=docuseal`, `EXTRACTION_ADAPTER=paddleocr`, `OPENAI_API_KEY`, `DOCUSEAL_*`, `OCR_URL`); `docker compose up -d`; first-time DocuSeal setup (admin, API key, webhook URL `http://host.docker.internal:3000/api/webhooks/esign` with the secret header); `npm run db:migrate && npm run db:seed`; `npm run dev` and `npm run worker` side by side; the script: invite (Demo, HHA, a phone number), open the phone from the caregiver page, intake, sign, send the three photos (one wrong to show a return), approve in `/queue`, click "Background check completed", show the pipeline board and `/conversations`.
- [ ] **Step 2: Open questions.** Add rows: TB test result stored as an ordinary (non-clinical-restricted) requirement in the DEMO set (`TB_TEST`, ADR-166); the agent FAQ wording is demo copy owned by the agency (`src/integrations/adapters/agent/faq.ts`); Twilio and A2P 10DLC are not started (ADR-162); OpenAI zero data retention and a BAA are needed before real caregiver data reaches the model (ADR-165).
- [ ] **Step 3: Full suite and final review.** `npm test`, `npm run build`, `npm run lint`; run the final whole-plan review; then do the runbook once end to end.
- [ ] **Step 4: Finish the plan** per `CLAUDE.md` § Finish: delete this plan file, record it under Finished plans in `docs/PROGRESS.md` with what changed and the commit range, and commit.
