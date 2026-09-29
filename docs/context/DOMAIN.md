# Domain glossary

Ubiquitous language. Use these exact names in code. If a concept is not here, add it here
before inventing a name for it.

## The pipeline

| Term | Meaning |
| --- | --- |
| **Caregiver** | A person with an accepted offer, being onboarded. Not an applicant — recruiting is out of scope. |
| **Agency** | The home care agency (tenant). Alvita Care is the first. All data is agency-scoped. |
| **Pipeline stage** | `INVITED → INTAKE → SIGNING → DOCUMENT_REVIEW → VERIFICATION → CLEARANCE → SYNCING → ACTIVE`, plus terminal `WITHDRAWN`. Explicit column, moved only by `domain/pipeline`. |
| **Pipeline event** | An append-only record of one stage transition: from, to, what caused it, who, when. Product history — "days in stage", time-to-clearance. Not the audit log, which stores no values and outlives the caregiver row. |
| **Withdrawal** | Staff taking a caregiver out of onboarding before `ACTIVE`, with a required free-text reason: a `WITHDRAWAL_RECORDED` pipeline event to terminal `WITHDRAWN`. A withdrawn caregiver cannot sign in, is not sent a queued invite, and leaves the pipeline board. Not reversible; a re-hire is a new caregiver. |
| **Blocker** | The one outstanding blocking requirement instance shown for a caregiver: `blocksClearance` and not `SATISFIED`. When several apply, the first by status in `EXCEPTION → EXPIRED → IN_REVIEW → PENDING → NOT_STARTED → WAIVED`, then lowest template key. None outstanding → no blocker. Rule: `src/domain/requirements/blocker.ts`. |
| **Document review cleared** | Every blocking DOCUMENT requirement instance is SATISFIED (and the caregiver has instances). Fires DOCUMENT_REVIEW_CLEARED (DOCUMENT_REVIEW → VERIFICATION) wherever a document is accepted or waived and when signing completes. Rule: src/domain/requirements/document-review.ts. |
| **Verification complete** | Every blocking requirement instance of every type is SATISFIED (and the caregiver has instances): the clearance readiness rule. Fires VERIFICATION_COMPLETED (VERIFICATION → CLEARANCE) wherever a requirement is satisfied. Rule: `src/domain/requirements/clearance.ts`. |
| **Sign-off** | The supervisor's confirmation that a caregiver at Clearance is cleared to work: a CLEARANCE_GRANTED pipeline event and a SIGN_OFF audit entry, each with who and when, committed with the caregiver's credentials and the queued AlayaCare sync. |
| **Success metrics report** | The agency admin's view of the PRD's success metrics over the last 90 days, computed on read from pipeline events, auto-accept decisions, the audit log and the sync log. Nothing is stored. A sync counts as without a manual fix only if its job was never requeued. Staff time and weekly-sample findings are not recorded, so are not measured. |
| **Cleared to work** | Every blocking requirement instance is `SATISFIED` and a supervisor has signed off. |
| **Invite** | The email that carries a caregiver's single-use invite link, recorded as an `Invite`: `QUEUED` until the queue sends it, then `SENT`, `REJECTED` (the mail provider refused the address) or `CANCELLED` (withdrawn, already started, or no email). Staff enter the caregiver's email, which becomes their sign-in key, when they create it. |

## Requirements

| Term | Meaning |
| --- | --- |
| **Requirement template** | A rule: "NY PCA must hold a valid PCA certificate". Has a type, accepted evidence, validity period, renewal rule, and `blocksClearance`. Data, not code. |
| **Requirement type** | `FORM` · `DOCUMENT` · `CHECK` · `TRAINING` · `ATTESTATION`. |
| **Template layer** | Templates stack: `STATE → SERVICE_TYPE → ROLE → PAYER → AGENCY`. Later layers override or add. Resolution is pure (`domain/requirements/resolve.ts`). |
| **Requirement instance** | One template applied to one caregiver. Holds evidence, status, expiry. The unit of everything. |
| **Instance status** | `NOT_STARTED → PENDING → IN_REVIEW → SATISFIED` / `EXCEPTION` / `WAIVED` / `EXPIRED`. |
| **Evidence** | What satisfies an instance: an uploaded document, a signed form, a check result, a training record, or an attestation. |
| **Accepted evidence** | The evidence kinds a template will accept. A TB requirement accepts a PPD result *or* a chest X-ray report. |
| **Template key** | The stable SCREAMING_SNAKE_CASE identity of a rule, e.g. `TB_SCREENING`. Shared across layers and versions: a narrower template with the same key overrides a broader one. |
| **Template version** | Templates are append-only. Editing publishes version `n+1` and retires version `n`; an instance points at a row, so its meaning is frozen at materialisation. At most one live version per (scope, key). |
| **Platform-owned template** | A `STATE`, `SERVICE_TYPE` or `PAYER` rule Credora ships, with no `agencyId`. Platform reference data every tenant reads, not tenant data — the one declared exception to "every row is agency-scoped" (ADR-014). An agency-owned template is the `AGENCY` layer. |
| **Evidence kind** | `UPLOADED_DOCUMENT` · `SIGNED_DOCUMENT` · `CHECK_RESULT` · `TRAINING_RECORD` · `ATTESTATION`. The five arms of **Evidence**, as the thing a template names in advance. |
| **Validity rule** | `NEVER_EXPIRES` · `FROM_EVIDENCE` (the expiry printed on the document governs) · `FIXED_PERIOD` (issue date + a number of months). One system, three rules; there is no second expiry mechanism. |
| **Renewal rule** | `NONE` · `ON_EXPIRY` · `ANNUAL` (a calendar cadence even where the evidence carries no expiry — NY in-service training). Recorded, not acted on: post-hire expiry monitoring is out of V1. |
| **Manual-only** | A requirement a regulator says a person must perform — I-9 §2, the NY Home Care Registry lookup. `manualOnly: true` plus the named regulation; there is no auto-accept path. Read only as a `SatisfactionPath`, never as a boolean. |
| **Check result** | The source of a `CHECK_RESULT` evidence row: that a named check was done, by which staff user, and when. For a manual-only requirement it is written only when staff record the check from the staff-checks list. |
| **Resolution context** | What templates are matched against: a caregiver's scope-axis values — state, service type, payer — plus their agency, and role, the highest certification declared on the home-care profile, derived at resolution and not stored. A template applies when every axis it sets equals the context's value. Stored on the caregiver as `workState`, `serviceType`, `payer`, set at invite. |
| **Template ambiguity** | Two or more live templates with the same key apply and none's scope strictly contains every other's. Resolution refuses rather than picks, and names the key and the competing templates. |
| **Service type** | `HHA` · `PCA`: the aide service the caregiver is hired to deliver. Not the certification they hold, which is the role axis. Values in `domain/requirements/vocabulary.ts`. |
| **Caregiver role** | `PCA` · `HHA` · `CNA`: the highest certification the caregiver self-asserted on the home-care profile, `null` when none. Values in `domain/requirements/vocabulary.ts`. |
| **Payer** | `PRIVATE_PAY` only in V1. No template uses the axis yet. |
| **Training minimum** | `minimumMinutes` on a `TRAINING` template: the annual minimum in whole minutes, versioned with the rule. |
| **Training completion** | A course the agency's training platform reports completed: platform caregiver id, course code and name, date, whole minutes. Stored once per (platform caregiver id, course, date), however many exports repeat it; the source of a `TRAINING_RECORD` evidence row. A course code starting `ORIENT-` is orientation, `INSVC-` in-service; any other counts toward nothing. |
| **Training platform id** | The caregiver's id on the training platform (`Caregiver.trainingPlatformId`), set by staff from an unmatched import row on /training. Until it is set, that id's completions are held with no caregiver. |
| **Training shortfall** | This calendar year's in-service minutes below the minimum pinned on the caregiver's in-service requirement. Computed at read time and shown on /training; a flag, never a status. |
| **Intake requirement** | A `FORM` template whose key gates an intake section. Its only evidence is an `ATTESTATION` `<KEY>_SUBMITTED`. |
| **Template override** | An AGENCY-layer template with a platform rule's key, whose scope copies every axis the rule sets plus the agency; it may narrow further but may not turn off `manualOnly` or `blocksClearance` (ADR-148). |
| **Template withdrawal** | Retiring the live version with no successor; agency rows from the admin UI, platform rows by the library seed (ADR-149). |

## Documents and review

| Term | Meaning |
| --- | --- |
| **Document set** | The list of documents this caregiver must sign, selected by state + service type + agency policy. Replaces the 29-document DocuSign packet. |
| **Document key** | The `evidenceKey` of a `SIGNED_DOCUMENT` accepted-evidence option. A document's identity across the set, the envelope and `SignedDocument.templateKey`; two requirements naming the same key share one signature. |
| **Generated form** | An official or agency PDF filled from the canonical record (W-4, IT-2104, I-9 §1, CHRC-102, NY wage notice, direct deposit). |
| **Attestation-only document** | Sign-only, no data entry. ~12 of the 29. |
| **Document template** | The code-declared wording of an agency document or attestation, keyed by document key and versioned; its version is stored on every signed copy. Sign-only templates print only the agency, the caregiver's legal name and the date. |
| **Envelope** | One e-sign transaction containing the whole document set. |
| **Envelope status** | `PREPARING → SENT → SIGNED / DECLINED / VOIDED`. A declined or voided envelope lets the caregiver prepare a fresh one. |
| **Attestation** | The recorded fact that a caregiver submitted something complete (an intake requirement key whose visible sections have nothing missing); the source of an `ATTESTATION` evidence row (ADR-080). |
| **Extraction** | OCR output: name, DOB, document number, issuer, issue date, expiry date, plus per-field confidence. |
| **Identity matching** | *Rule-based.* Do name, DOB, and ID numbers agree across licence, passport, SSN card, other documents, and intake? Tolerant of formatting, middle names, documented name changes. Never an LLM. |
| **Home-care record validity** | *LLM judge.* Is this certificate/TB result/immunisation record unexpired, plausibly dated, matched to the requirement, and from a legitimate issuer? Returns verdict + confidence + reasons quoting the document. |
| **Issuer allowlist** | Agency-maintained list of accepted training programs and clinics. Checked before the judge is trusted. |
| **Auto-accept** | The requirement is not manual-only **and** the extraction is confident **and** identity matched **and** the judge step passed (an accepted issuer, or `VALID` above threshold, with the date rules met). Anything else → exception queue. |
| **Exception queue** | Staff worklist of requirement instances automatic review sent to staff (EXCEPTION), one per instance — the document whose auto-accept decision flagged it — showing what failed and the judge's reasoning (a clinic result's reasons are not shown). Staff accept the document, reject it, ask for a clearer photo, or waive the requirement; a returned item waits on the caregiver until they upload again. Also lists stalled reviews, stopped e-signature steps and unsent caregiver texts, each with a retry. |
| **Stalled review** | An uploaded document whose reading, judge or decision job failed permanently (dead-lettered), left undecided with its requirement still PENDING. Shown in the exception queue; staff retry it. |
| **Staff decision** | Staff's recorded decision on one flagged document: ACCEPTED (satisfies the requirement and backs its credential), REJECTED or REUPLOAD_REQUESTED (the requirement stays EXCEPTION and the caregiver is emailed to upload again). Who and when; never a free-text reason. |
| **Waiver** | Staff moving an EXCEPTION requirement instance to WAIVED from the exception queue, recorded with who and when on the instance. Terminal; does not count toward clearance (OPEN-QUESTIONS 38). |
| **Weekly sampling** | Staff review a sample of auto-accepted records each week: up to ten documents whose auto-accept decision satisfied their requirement in the last complete ISO week (UTC), chosen deterministically from that week, shown with identity outcomes and the judge's reasoning. Target <1% later found invalid. Nothing is stored. |
| **Accepted issuer** | One entry in an agency's issuer allowlist: a name as printed on documents and a kind. Matched exactly after normalisation; a match means the judge is not asked whether the issuer is legitimate. |
| **Judge decision** | The recorded outcome of the judge step for one document: an accepted-issuer match (the judge not asked) or the judge's verdict, confidence, reasons and model, plus any staff reasons (manual-only, expired, undated, verdict not VALID, low confidence, mock verdict). No staff reasons means the step passes; it never accepts on its own. |
| **Auto-accept decision** | The recorded outcome of auto-accept for one document: the checks that sent it to staff (none means accepted), what identity matching found for name and DOB, and what it moved the requirement instance to, if anything. |
| **Issuer kind** | `TRAINING_PROGRAM` · `CLINIC` · `STATE_AGENCY`, from the PRD's "recognized training program, licensed clinic, or state agency". |
| **Agency default template** | An `AGENCY`-layer rule copied into one agency from Credora's NY starting list, e.g. the PHI acknowledgement. The agency owns and edits its copy. |

## Checks and verification

| Term | Meaning |
| --- | --- |
| **CHRC** | NY DOH Criminal History Record Check. Fingerprint-based. Form CHRC-102 + questionnaire. Tracked as a coordinator task — no integration in V1. |
| **CHRC submission** | Staff's record that a caregiver's CHRC request was submitted to NY DOH: by whom and when. Moves the CHRC requirement to in progress; DOH's favourable result, recorded by staff as a check result, satisfies it. |
| **Background check** | Third-party vendor check, separate from CHRC. Requires a standalone FCRA disclosure and consent signed *before* the check runs. |
| **Background check order** | Staff's request that the agency's vendor run a caregiver's background check. It is refused unless the signed FCRA disclosure is on file. It carries the agency's package code, the vendor's order id and the last status the vendor reported (`REQUESTED → ORDERED → PENDING → CLEAR \| CONSIDER`). CLEAR satisfies the requirement. CONSIDER sends it to staff review and never fails anyone automatically. After reviewing the report with the vendor, staff clear it (SATISFIED, with a check result under their name) or fail it (EXCEPTION, which blocks clearance but withdraws no one). |
| **NY Home Care Registry** | State registry for HHA/PCA certification lookup. Manual staff step in V1 unless an approved automated method exists. |
| **I-9 §1 / §2** | §1 is the caregiver's part (generated and e-signed). §2 is the employer examining physical documents — legally a person's job, always a staff task. |
| **Health screening** | Physical exam, TB screening (PPD test *or* chest X-ray), immunisations. Structured requirements with result + date: an accepted clinic document waits in review until a supervisor records Passed or Failed and the result date. The result lives in the medical store; a pass and its date are copied onto the requirement. |
| **Consents** | Hep B consent or declination, flu declination with reason, COVID status. |
| **Reference** | A named past employer/supervisor. Minimum 2. Contacted by a tokenised web form; escalates to staff after 2 missed attempts. |
| **Reference request** | Staff send one reference the short web form. It is chased once more after a miss and escalated to staff after two. States: `NOT_REQUESTED` → `REQUESTED` → `RESPONDED` \| `ESCALATED` (an escalated reference may still answer, by the form or by phone). |
| **Reference attempt** | One request sent to a reference: `SENT`, `REJECTED` or `UNANSWERED`. A miss is `REJECTED`, or `UNANSWERED` once `REFERENCE_RESPONSE_WINDOW_HOURS` pass with no answer. |
| **Reference check** | The `REFERENCE_CHECK` requirement: satisfied when two references confirm they worked with the caregiver and recommend them. Any other answer puts it in review for a person and never fails anyone automatically. After reading the answers, staff satisfy it (SATISFIED, with a check result under their name) or fail it (EXCEPTION, which blocks clearance but withdraws no one). |
| **Link token** | A single-use, expiring, unguessable URL credential that lets a person with no login act on exactly one record: an invite (`INVITE`), a reference form (`REFERENCE_FORM`) or a staff invite (`STAFF_INVITE`, a new staff user choosing their first password). Opening does not use it; completing does. Sending a new one expires the old. |
| **One-time code** | A six-digit code emailed to a caregiver's sign-in address to sign them in. Single-use, 10 minutes, 5 attempts, stored only as a keyed hash. |
| **Caregiver session** | Password-less, phone-proven, 2 hours; the only way a caregiver acts as a CAREGIVER principal. |

## Credentials

| Term | Meaning |
| --- | --- |
| **Credential** | A verified, dated, expiring qualification: PCA, HHA, CNA, CPR, TB clearance, physical. Has type, number, issuer, issue date, expiry, evidence file, verification status. Recorded once, at supervisor sign-off, from a satisfied requirement whose accepted upload is a certificate, physical or TB result; its expiry follows the requirement's validity rule (ADR-107). |
| **Certification levels** | `PCA` (Personal Care Aide) · `HHA` (Home Health Aide) · `CNA` (Certified Nursing Assistant). |
| **Expiry date** | Recorded at activation and synced to AlayaCare. Monitoring it after hire is explicitly **out of V1 scope**. |
| **Credential verification status** | `UNVERIFIED → VERIFIED` / `REJECTED`. Whether we have checked the credential document itself. Not the same as an **instance status** — clearance reads the requirement instance, never this. |

## Integration

| Term | Meaning |
| --- | --- |
| **AlayaCare** | The agency's system of record. We write caregiver profiles, credentials with expiry, and documents into it. |
| **Field mapping** | Per-agency configuration from our canonical record to that agency's AlayaCare fields including custom fields. Editable by implementation staff without a deploy. |
| **Conflict** | AlayaCare holds a different value than we do. The sync stops instead of overwriting; staff see both values and choose, per name, email or phone field, which one AlayaCare keeps. A date of birth is never chosen, only corrected. |
| **Sync log** | One entry per AlayaCare sync: its outcome (synced, conflict, rejected, or still running), AlayaCare's id for the caregiver, the mapping version used, credentials written, what the mapping could not fill, and conflicting field names. Never a value. |
| **Sync preview** | What an AlayaCare sync would send for one caregiver — profile, credentials, custom fields, and each signed document as sent or not sent — plus the mapping's gaps. Signposted on the clearance screen until the agency's first sync succeeds. Informational: it sends nothing and does not hold the sync. |

## Roles

`CAREGIVER` · `COORDINATOR` · `SUPERVISOR` · `AGENCY_ADMIN` · `IMPLEMENTATION`.
See `SECURITY.md` for what each may see.

## Words we do not use

"Applicant" (recruiting is out of scope — they are a Caregiver from accepted offer onward),
"onboardee", "packet" (it is a *document set*), "verification" as a synonym for review
(verification means module 5 checks specifically), "AI" (say "the judge" or "extraction").
