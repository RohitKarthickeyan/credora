# Data model

One canonical caregiver record feeds every form, check, and sync. ~100 unique fields replace
the repeated entries across the 29-document packet. **A field is captured exactly once.**

## Storage tiers

| Tier | Rule |
| --- | --- |
| **Standard** | Normal columns in the `core` schema. |
| **Sensitive** | In `core`, but the value column is ciphertext (see below) and masked by default in the UI. |
| **Restricted** | A separate Postgres schema, separate Prisma model group, reachable only through `src/db/restricted/*`. Never joined into a caregiver query. |

## Postgres schemas

```
core        canonical record, requirements, documents, pipeline, audit, integrations
medical     medical history questionnaire, physical capability answers, screening detail
eeoc        voluntary self-identification (gender, race/ethnicity)
```

`medical` and `eeoc` are separate schemas, not separate tables in `core`. Prisma
`multiSchema` is enabled. The application connects with one role that can reach all three;
access is gated in code by `src/db/restricted/`, which is the only place those models may be
imported, and which writes an audit entry on every read.

Why separate: the personnel file must not contain medical answers, and EEOC data must never
reach a coordinator, a supervisor, or AlayaCare. A schema boundary makes an accidental
`include:` impossible rather than merely discouraged.

## Field groups

| Group | Key fields | Tier |
| --- | --- | --- |
| Identity | legal name, other names, DOB, **SSN**, gender, marital status, country of birth, CHRC physical descriptors (height, weight, eye/hair colour) | Sensitive (SSN encrypted) |
| Contact | address, phones, email (the sign-in key), preferred language | Standard |
| Government IDs | driver's licence + state, work authorisation doc type, **number**, expiry | Sensitive (number encrypted) |
| Home-care profile | certifications held, care-setting experience + years, clinical skills checklist, shift types, willing-to-work locations, pet/smoker tolerance, languages, vehicle, COVID status, Hep B choice, flu choice + declination reason | Standard |
| History | employment (≤5), education (≤3), references (≥2), emergency contacts (≤2) | Standard |
| Credentials | type, number, issuer, issue date, expiry, evidence file, verification status | Standard |
| Screening results | background check, CHRC, registry checks — **status and date only** | Sensitive |
| Payroll inputs | pay rates, W-4 and IT-2104 elections, **bank routing + account** | Sensitive (bank encrypted) |
| Signed documents | template, version, envelope id, signed PDF, timestamp | Standard |
| Medical | medical history questionnaire, physical capability answers, screening detail | **Restricted** (`medical`) |
| EEOC | gender, race/ethnicity from the voluntary form | **Restricted** (`eeoc`) |

Health screening has two halves on purpose: the **pass/fail + date** needed for clearance
lives in `core` as a requirement instance; the **clinical detail** lives in `medical`.
Clearance never needs to read `medical`. The supervisor's result is written to
`MedicalScreeningResult` and copied once, through `readMedicalClearanceResults`, onto the
instance: a pass as `SATISFIED` plus `resultedOn`, a fail as `EXCEPTION`.

## Field-level encryption

Encrypted at the application layer, not by Postgres, so ciphertext is opaque to anyone with a
database connection.

- AES-256-GCM, key from `FIELD_ENCRYPTION_KEY`, per-value random 96-bit nonce, key id carried
  inside the ciphertext envelope for rotation.
- Stored as `Bytes`. Never indexed, never in a `WHERE`, never logged. Presence — `IS NOT NULL`
  projected in a `SELECT`, never a filter — is read only by `src/db/repositories/caregiver-record.ts`,
  so intake can say a number is on file without the envelope leaving Postgres (ADR-066).
- Exactly one module does this: `src/db/crypto.ts`. Repositories call it; nothing else does.
- `StaffMfa.totpSecretEnc`, a staff user's TOTP secret and not caregiver data, is the fifth
  encrypted column; it is decrypted only in `src/db/repositories/staff-mfa.ts` (ADR-142).
- SSN additionally stores `ssnLast4` in plaintext — staff need to disambiguate, and the last
  four are not the identifier.

## Core entities

```
Agency 1─n User
User 1─1 StaffMfa 1─n StaffRecoveryCode   (TOTP second factor; T-023)
Agency 1─n Caregiver
Agency 1─n RequirementTemplate      (layered; see DOMAIN.md)
Agency 1─1 AlayaCareMapping
Agency 1─n AcceptedIssuer           (the issuer allowlist; agency-owned, retired never deleted)
Agency 1─n TrainingImport 1─n TrainingImportRejection   (each scheduled export read, and its rows that could not be read; T-090)

Caregiver 1─1 IdentityRecord, ContactRecord, HomeCareProfile, PayrollInputs
Caregiver 1─n CareSettingExperience  (setting + years; the one multi-valued profile item with a value per member)
Caregiver 1─n EmploymentEntry, EducationEntry, Reference, EmergencyContact
Caregiver 1─n RequirementInstance   ← the spine
Caregiver 1─n Attestation   (a submitted intake key; source of an ATTESTATION evidence row, ADR-080)
Caregiver 1─n CheckResult   (a recorded check; source of a CHECK_RESULT evidence row, ADR-093)
Caregiver 1─n TrainingCompletion (caregiverId null until the platform id is linked; source of a TRAINING_RECORD evidence row; T-090)
Caregiver 1─1 ChrcSubmission (the CHRC request submitted to NY DOH, by whom and when; ADR-100)
Caregiver 1─1 BackgroundCheckOrder (the vendor order: package code, vendor id, last status; T-081)
Reference 1─n ReferenceAttempt (each request sent, its channels and outcome; T-082)
Caregiver 1─n UploadedDocument 1─1 Extraction     (fields as printed; text null for a clinic result — ADR-082)
Caregiver 1─n Credential   (recorded at sign-off from a SATISFIED instance and its accepted upload — ADR-107)
Caregiver 1─n SignedDocument
Caregiver 1─n Envelope 1─n EnvelopeDocument   (one live or signed envelope per caregiver; SignedDocument.envelopeId = Envelope.vendorEnvelopeId)
Caregiver 1─n PipelineEvent
Caregiver 1─n Invite
Caregiver 1─1 MedicalFile           (schema: medical)
Caregiver 1─n MedicalAnswer         (schema: medical — questionnaire, capability, screening detail)
Caregiver 1─n MedicalScreeningResult (schema: medical — item + pass/fail + date, no detail)
Caregiver 1─n ClinicalDocumentText (schema: medical — OCR text of a clinic result)
Caregiver 1─n ClinicalJudgeReasons (schema: medical — judge reasons quoting a clinic result)
Caregiver 1─1 EeocRecord            (schema: eeoc)
                                    (medical/eeoc: a cardinality, not a relation — no foreign key in either schema)

RequirementTemplate 1─n AcceptedEvidence   (a PPD result *or* a chest X-ray; satisfying one is enough)
RequirementInstance n─1 RequirementTemplate
RequirementInstance 1─n Evidence    → UploadedDocument | SignedDocument | CheckResult | TrainingCompletion | Attestation
UploadedDocument 1─1 JudgeDecision   (allowlisted issuer, or input hash, verdict, confidence, reasons, model version; staff reasons — ADR-097)
UploadedDocument 1─1 AutoAcceptDecision (staff reasons, name and DOB outcomes, instance status set — ADR-101)
UploadedDocument 1─1 StaffDocumentDecision (accepted / rejected / re-upload requested, by whom, when, caregiver text status — ADR-110)

Caregiver 1─n AlayaCareSync   (the AlayaCare sync log, one row per sync job; attempts are JobAttempt — ADR-116)
AuditEntry  (actor, action, entity, field?, reason?, at)
```

Government IDs are columns on `IdentityRecord`, not a fifth satellite: they are identity
documents, they share the Identity group's tier, and every consumer reads them with the name.

## Invariants

1. Every caregiver-visible field maps to exactly one column. No duplicated `firstName` on a form model.
2. `RequirementInstance.status` is the only source of truth for clearance. Nothing recomputes it ad hoc.
3. Deleting a caregiver deletes its `medical` and `eeoc` rows — **in code, not by cascade**:
   there is no foreign key across a schema boundary, so the delete use case calls
   `deleteMedicalFile` and `deleteEeocRecord` in the same transaction (T-130). Retention rules
   (`SECURITY.md`) may delete earlier.
4. `Credential.expiresAt` is set at supervisor sign-off (ADR-108) and synced. Nothing in V1 watches it afterwards.
5. Every row is agency-scoped. Every repository takes `agencyId`. There is no unscoped read.

`RequirementTemplate` and `AcceptedEvidence` take a declared exception to invariant 5 (ADR-014):
their `agencyId` is nullable, and null means the rule is platform reference data — a `STATE`,
`SERVICE_TYPE` or `PAYER` template Credora ships and every tenant reads. Forcing it into a tenant
would mean one copy per agency, diverging silently, with no way to ship a correction. The
repository signature is unchanged: `agencyId` is still the first parameter and every read is
`WHERE "agencyId" IS NULL OR "agencyId" = :agencyId`. A write with `agencyId = null` is reachable
only from the seeder. No other core model may make `agencyId` nullable.

`findUserForSignIn` in `src/db/repositories/users.ts` is a declared read that does not take
`agencyId` (ADR-026). Staff sign in with no tenant selector, so before sign-in there is no agency
to scope by: it reads one `User` row by its globally unique `email`, and that row is what
resolves the agency. It returns no caregiver data. Every per-request read stays scoped — the
session cookie carries `agencyId` beside the user id so `findUserForSession` takes `agencyId`
first like every other repository.

`findCaregiversByEmail` in `src/db/repositories/caregiver-sign-in.ts` is a declared read that
does not take `agencyId` (ADR-058, T-021, ADR-161). Caregivers sign in by email with no tenant
selector, so before sign-in there is no agency to scope by: it reads the `ContactRecord` rows
holding the entered lower-cased `email` whose caregiver is not `WITHDRAWN`, and returns only `agencyId` and
`caregiverId`, at most two. A code is sent only when exactly one matches. Every per-request read
stays scoped — the caregiver session cookie carries `agencyId` beside the caregiver id. Its single
permitted caller is `src/server/auth/caregiver-session.ts`.

`listOutboxMessages` in `src/db/repositories/sent-messages.ts` is a declared read that does not
take `agencyId` (ADR-043, T-051). It lists the mock messaging adapter's `SentMessage` rows across
every agency, because a developer reading `/dev/outbox` does not know which agency id a seeded or
test flow used. Its single permitted caller is `src/server/dev/outbox.ts`, called only by a
`.dev.tsx` page that has no production route (ADR-011); any other caller is a review failure.

`findWebhookSubjectAgency` in `src/db/repositories/inbound-webhooks.ts` is a declared read that
does not take `agencyId` (ADR-044, T-058). A signed vendor callback carries only the vendor's
envelope or order id, never an agency, and a `Job` cannot be enqueued without one, so the
`WebhookSubject` row — `(provider, externalId)`, unique across tenants and registered by the task
that created the envelope or order — is what resolves the agency. It returns only an `agencyId`.
Its single permitted caller is `src/server/webhooks/receive.ts`, after the signature has been
verified; any other caller is a review failure.

`listAgencyIds` in `src/db/repositories/retention.ts` is a declared read that does not take
`agencyId` (ADR-155, T-130). A `Job` needs an `agencyId`, so the daily retention sweep is
scheduled per agency, and worker boot is the one moment that sees every agency. It returns only
agency ids. Its single permitted caller is `src/server/retention/schedule.ts`; any other caller is
a review failure.
