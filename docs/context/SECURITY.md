# Security, privacy, and regulatory rules

Credora holds SSNs, bank accounts, immigration documents, and medical answers. These are
launch requirements, not hardening to do later.

## Roles and access

| Role | Sees | Never sees |
| --- | --- | --- |
| `CAREGIVER` | Own record only, including own medical answers | Any other caregiver |
| `COORDINATOR` | All caregivers in the agency; pipeline, documents, exceptions | Medical detail, EEOC, unmasked SSN/bank without a logged reason |
| `SUPERVISOR` | Pipeline and the caregiver page (ADR-167), without the sensitive fields; medical **results** needed for clearance (pass/fail + date) | Medical questionnaire detail, EEOC, payroll, the masked SSN/bank fields |
| `AGENCY_ADMIN` | Configuration, users, reports | Medical detail, EEOC individual rows |
| `IMPLEMENTATION` | Configuration only — templates, field mapping. Every action audited | Caregiver records |

EEOC data is visible to **no role** in the UI. It is reachable only by an aggregate report
that refuses to return a group smaller than 5.

## Authorization

Enforced in `src/server/auth/policy.ts`, called by every use case. Not in the UI, not in
middleware alone. Every exported function under `src/server/**` is a use case made by
`defineUseCase`, which calls the policy before anything else runs.

## Field masking

Sensitive fields render masked (`•••-••-1234`). Revealing requires a **reason string**, which
is written to the audit log with the actor and timestamp. Implemented once, in a `<Sensitive>`
component plus a `revealSensitiveField` server action. There is no other way to decrypt.
The one other decrypt is `readSealedFormValues`, which prints the SSN, bank and work-authorisation numbers onto official forms inside T-064's send and writes a `VIEW` entry per field, with a system reason, in the same transaction (ADR-069).
`Message.ssnEnc`, an SSN a caregiver texted, is decrypted only by `readMessageSsn` (`src/db/mapping/message-ssn.ts`) inside `saveTextIntakeField`, to be written straight to that caregiver's own SSN column (ADR-163).
`StaffMfa.totpSecretEnc`, a staff user's TOTP secret and not caregiver data, is decrypted only in `src/db/repositories/staff-mfa.ts`, to check a code or to show the key during enrolment (ADR-142).

## Audit log

Append-only `AuditEntry` for every view, edit, export, and sign-off on a caregiver record —
plus every read of a restricted store and every judge decision. Written inside the same
transaction as the action, so an unaudited write is impossible.

Fields: `actorId, actorRole, action, entityType, entityId, fieldName?, reason?, ip, at`.
No values are stored in the audit log — only that a field was touched.

## Sessions

- Staff: email + password (argon2/bcrypt), session in an httpOnly, `SameSite=Lax`, secure
  cookie signed with `jose`. MFA is an enforced flag per agency; SSO is a post-V1 adapter.
  Second factor: TOTP (RFC 6238, 6 digits, 30 s) after the password; the session cookie is issued
  only after it passes. Required per agency (`Agency.mfaRequired`, default on); an enrolled user
  is always asked. Ten single-use recovery codes, stored as SHA-256. Ten wrong codes lock the
  second step until an agency admin resets it (ADR-143, OPEN-QUESTIONS 235).
- Caregiver: emailed one-time code (ADR-161). Short-lived session, mobile-first, no password —
  caregivers use this once. Code: 6 digits, 10 minutes, 5 attempts; session 2 hours absolute
  (ADR-059). Every sign-in response (redirect, cookies, copy, and timing up to one lookup) is the
  same whether or not the address belongs to a live caregiver; the code is created and emailed
  after the response (ADR-061).
- Reference forms and invites: a single-use random token in the URL, stored only as its SHA-256
  hash, no session, scoped to one subject (ADR-027).

## LLM provider constraints

Any LLM provider used for document review must offer **zero data retention** and sign a BAA.
Send it only the fields it needs. Specifically, the judge receives the extracted document
text and the requirement description — **never** SSN, bank details, address, or DOB beyond
what appears on the document being judged. Enforced by a redaction step in
`src/server/review/judge.ts`, which builds the prompt from the redacted text only.

## Retention

Per document type, configured as data:

- I-9 and supporting documents: 3 years after hire or 1 year after termination, whichever is later.
- Applicants who never start intake: deleted 30 days after invite expiry.
- Background check results: per vendor contract, default 7 years.
- Medical store: retained separately from the personnel file, deleted on the personnel schedule.
- Unsigned generated PDFs (they print SSN and bank numbers): deleted once the envelope is signed, declined or voided, or the caregiver withdrew.
- Vendor webhook deliveries: background check 7 years, e-sign 90 days (OPEN-QUESTIONS 255).
- Audit log: 7 years, never while the caregiver it is about is on file (OPEN-QUESTIONS 252).

The table is `RETENTION_PERIODS` in `src/domain/retention/rules.ts`. A scheduled job in `src/server/retention/` applies these. Deletions are audited.

## Regulatory constraints that shape code

| Rule | Consequence in code |
| --- | --- |
| I-9 §2 requires a person to examine documents | `I9_SECTION_2` is a `CHECK` requirement with `manualOnly: true`. No auto-accept path exists for it. |
| FCRA needs standalone disclosure and consent before any check | The background-check use case asserts a signed `FCRA_DISCLOSURE` document exists, or it refuses to run. |
| NY Home Care Registry lookup | `manualOnly: true` staff task until an approved automated method exists. |
| E-signature legal validity | Delegated entirely to the e-sign provider. We store envelope id, template version, timestamp, and the signed PDF. We do not build signatures. |
| Medical/EEOC separation | Separate Postgres schemas (`DATA-MODEL.md`). |
| HIPAA BAA per agency | PHI acknowledgement workflow is an agency-configured requirement. |

`manualOnly: true` on a requirement template is the single mechanism that keeps legally
person-assigned steps away from automation. It is checked in the auto-accept rule.

## Not in V1

SOC 2 certification, SSO, continuous compliance monitoring, penetration testing.
Counsel review is required before real caregiver data is stored — a deployment gate, not a code task.
