# Module map

**Start here to locate code.** This is the index from a PRD module to the directories that
implement it and the tasks that built it. One hop, no searching.

Keep it current: when a task creates a directory not listed here, add the row in the same
change. A missing row is a defect — it forces the next agent to grep.

| # | PRD module | Owns these directories | Tasks |
| --- | --- | --- | --- |
| 1 | Caregiver intake | `src/app/(caregiver)/intake/`, `src/server/intake/`, `src/domain/validation/`, `src/domain/forms/`, `src/app/(caregiver)/record/` (T-131, caregiver self-view), `src/domain/forms/summary.ts` (T-131) | T-004, T-040, T-041, T-042, T-043, T-044, T-045, T-046, T-047, T-131 |
| 2 | Form generation and e-signature | `src/server/forms/`, `src/domain/documents/document-set.ts`, `src/domain/documents/agency-templates.ts`, `src/domain/documents/agency-document.ts`, `src/db/repositories/agency-document-context.ts`, `src/db/repositories/document-set.ts`, `src/domain/documents/official-form*.ts`, `src/db/repositories/official-form-record.ts`, `src/db/repositories/sealed-form-values.ts` (ADR-069), `src/domain/documents/envelope.ts`, `src/db/repositories/envelopes.ts`, `src/db/repositories/signed-documents.ts`, `src/app/(caregiver)/sign/` (ADR-077/078), `src/server/forms/official/` (pinned PDFs, ADR-070), `src/integrations/adapters/esign/`, `forms/` (PDF templates) | T-052, T-060, T-061, T-062, T-064 |
| 3 | Document capture and review | `src/app/(caregiver)/documents/`, `src/server/documents/`, `src/domain/documents/upload.ts`, `src/db/repositories/uploaded-documents.ts`, `src/app/(staff)/admin/issuers/`, `src/server/review/`, `src/domain/identity/`, `src/integrations/adapters/extraction/`, `src/integrations/adapters/judge/` | T-053, T-054, T-070, T-071, T-072, T-073, T-074, T-075, T-076, T-077 |
| 4 | Requirements engine | `src/domain/requirements/`, `src/domain/requirements/role.ts` (T-036), `src/server/requirements/`, `src/app/(staff)/admin/requirements/` | T-030, T-031, T-032, T-033, T-034, T-036 |
| 5 | Verification workflows | `src/domain/forms/vaccination.ts` (T-084; the two vaccination intake sections, cross-listed from row 1), `src/server/verification/` (T-082: `references.ts`, `reference-jobs.ts`), `src/app/r/reference/[token]/` (T-082; public reference form), `src/domain/requirements/reference-check.ts`, `src/db/repositories/reference-checks.ts` (T-082; References section in `src/app/(staff)/checks/`), `src/integrations/adapters/backgroundCheck/`, `src/domain/requirements/background-check.ts`, `src/db/repositories/background-check-orders.ts`, `src/app/dev/background-check/` (T-081; ordering UI in `src/app/(staff)/checks/`), `src/domain/requirements/health-screening.ts`, `src/db/repositories/health-screening.ts` (T-083; result dialog `src/app/(staff)/clearance/record-health-screening-result.tsx`) | T-055, T-080, T-081, T-082, T-083, T-084 |
| 6 | Training hours tracking | `src/server/training/`, `src/integrations/adapters/training/`, `src/domain/requirements/training-hours.ts`, `src/db/repositories/training.ts`, `src/app/(staff)/training/` (T-090) | T-057, T-090 |
| 7 | Clearance and sign-off | `src/app/(staff)/clearance/`, `src/server/clearance/`, `src/domain/requirements/clearance.ts` | T-100, T-101 |
| 8 | AlayaCare sync | `src/domain/sync/`, `src/server/sync/`, `src/db/repositories/alayacare-mapping.ts`, `src/integrations/adapters/alayacare/`, `mock-servers/alayacare/`, `src/app/(staff)/admin/mapping/`, `src/app/(staff)/caregivers/[id]/alayacare/` (T-112; first-sync preview), `src/app/(staff)/sync/` (T-113; conflicts) | T-056, T-110, T-111, T-112, T-113, T-114, T-115 |
| 9 | Coordinator dashboard | `src/app/(staff)/pipeline/`, `src/app/(staff)/queue/`, `src/app/(staff)/caregivers/`, `src/app/(staff)/reports/`, `src/domain/pipeline/`, `src/domain/requirements/credential.ts`, `src/db/repositories/credentials.ts`, `src/server/credentials/` | T-015, T-102, T-120, T-121, T-122, T-123, T-124, T-141 |
| — | Platform / cross-cutting | `src/lib/`, `src/ui/`, `src/db/`, `src/integrations/queue/`, `src/integrations/adapters/storage/`, `src/domain/auth/`, `src/domain/masking/`, `src/server/auth/`, `src/server/audit/`, `src/server/caregivers/`, `src/server/retention/`, `src/domain/retention/` (T-130), `src/server/jobs/`, `src/server/webhooks/`, `src/app/api/webhooks/`, `src/app/verify/`, `src/app/_components/`, `prisma/`, `scripts/` | T-001 – T-005, T-010 – T-019, T-020 – T-024, T-050, T-051, T-058, T-130, T-132, T-133, T-134, T-140 |
| — | Caregiver conversation | `src/domain/conversation/`, `src/server/conversation/`, `src/db/repositories/conversations.ts`, `src/app/dev/phone/`, `src/app/(staff)/conversations/` (staff list; transcript card on `caregivers/[id]/`) | ADR-162 |

## Reverse index — "which task owns this directory?"

| Directory | Primary task | Then extended by |
| --- | --- | --- |
| `prisma/schema.prisma` | T-010 | T-011, T-012, T-013, T-015, T-016, T-030 |
| `src/db/crypto.ts` | T-012 | — |
| `src/db/repositories/sensitive-field.ts` | T-019 | — (the one read-path decrypt; ADR-022) |
| `src/domain/masking/` | T-019 | — |
| `src/db/restricted/` | T-011 | T-045, T-083 |
| `src/domain/requirements/` | T-031 | T-032, T-033 (`vocabulary.ts`), T-100, T-120 (`blocker.ts`) |
| `src/db/repositories/requirement-template-writer.ts`, `src/db/seeds/ny-requirement-templates.ts` | T-033 | T-034, T-132 |
| `src/domain/identity/`, `src/db/repositories/intake-identity.ts` | T-072 | T-074 (`matchIdentity`, `findIntakeIdentity`) |
| `src/domain/requirements/manual-check.ts`, `src/db/repositories/check-results.ts`, `src/db/repositories/manual-checks.ts`, `src/server/review/manual-checks.ts`, `src/app/(staff)/checks/` | T-076 | T-080, T-081 (`CheckResult`), T-100/T-122 (reuse `recordManualCheck`) |
| `src/domain/requirements/chrc.ts`, `src/db/repositories/chrc.ts`, `src/server/verification/chrc.ts`, `src/app/(staff)/checks/record-chrc-step.tsx` | T-080 | staff views call `recordChrcStep` |
| `src/domain/pipeline/` | T-015 | T-120 (`board.ts`) |
| `src/domain/sync/`, `src/server/sync/alayacare-mapping.ts`, `src/db/repositories/alayacare-mapping.ts`, `src/app/(staff)/admin/mapping/` | T-110 | T-111, T-112, T-114, T-115, T-132 |
| `src/domain/requirements/blocker.ts` | T-120 | T-100 (reuse the predicate) |
| `src/server/caregivers/pipeline-board.ts`, `src/db/repositories/pipeline-board.ts` | T-120 | T-122 (name links to the record) |
| `src/app/(staff)/caregivers/[id]/`, `src/server/caregivers/{caregiver-detail,resend-invite,correct-email}.ts`, `src/server/forms/void-envelope.ts`, `src/db/repositories/caregiver-detail.ts` | T-122 | T-100 (requirement screen), T-123 |
| `src/domain/documents/judge-redaction.ts`, `src/domain/documents/judge-review.ts`, `src/db/repositories/judge-decisions.ts`, `src/server/review/judge.ts` | T-073 | T-074 (`findJudgeDecision`), T-075, T-121 (`readJudgeReasons`) |
| `src/domain/documents/auto-accept.ts`, `src/db/repositories/auto-accept-decisions.ts`, `src/server/review/auto-accept-job.ts` | T-074 | T-075, T-121 (`findAutoAcceptDecision`) |
| `src/domain/documents/` | T-060 (`document-set.ts`), T-077 (`accepted-issuer.ts`), T-062 (`agency-templates.ts`, `agency-document.ts`), T-070 (`upload.ts`), T-064 (`envelope.ts`) | T-074 |
| `src/integrations/ports/` | T-050 | one file per adapter task |
| `src/integrations/queue/` | T-016 | T-018, T-044 (`enqueueJobInTransaction`), T-111, T-130, T-134 (`worker.ts`) |
| `src/server/jobs/handlers.ts` (`jobRegistry`), `scripts/worker.ts` | T-134 | every task that adds a job handler registers it here (ADR-089) |
| `src/integrations/adapters/storage/` | T-017 | — |
| `src/domain/forms/` | T-040 | T-047, T-042, T-043, T-046 |
| `src/domain/forms/sections/` (one file per intake section, kebab-case ids) | T-043 | T-041, T-042, T-045, T-046, T-048 |
| `src/db/repositories/caregiver-record.ts`, `src/server/intake/section.ts` | T-047 | T-041 – T-046 |
| `src/domain/pipeline/invite.ts`, `src/db/repositories/invites.ts`, `src/server/caregivers/invite.ts`, `src/server/caregivers/invite-email-job.ts`, `src/server/caregivers/invite-link.ts`, `src/app/(staff)/caregivers/new/`, `src/app/r/invite/` | T-044 | T-122 (resend) |
| `src/domain/pipeline/withdrawal.ts`, `src/server/caregivers/withdraw.ts`, `src/app/(staff)/pipeline/actions.ts`, `src/app/(staff)/pipeline/withdraw-caregiver.tsx` (ADR-079) | T-124 | T-101 (reuse `WithdrawCaregiver`) |
| `src/domain/forms/intake-flow.ts` (`ALL_SECTIONS`, ADR-081) | T-041 | T-042, T-045, T-048 |
| `src/server/intake/flow.ts` (`storeFor`, the one store dispatch), `src/app/(caregiver)/intake/[step]/` | T-041 | T-045, T-048 |
| `src/db/repositories/attestations.ts` (ADR-080) | T-041 | — |
| `src/domain/forms/restricted.ts`, `src/domain/forms/sections/medical-questionnaire.ts`, `src/domain/forms/sections/eeoc-self-identification.ts`, `src/server/intake/restricted-sections.ts` (ADR-084) | T-045 | T-083 |
| `src/domain/forms/sections/contact.ts`, `src/db/repositories/contact-preferences.ts`, `src/server/caregivers/contact-preferences.ts`, `src/app/(caregiver)/intake/_contact/` (ADR-087, ADR-161) | T-048 | T-122 (sign-in email correction) |
| `prisma/seed.ts`, `prisma/tsconfig.seed.json` (ADR-085), `src/db/seeds/alvita.ts`, `src/server/dev/demo-seed.ts` (`DEMO_CAREGIVERS`, ADR-086) | T-132 | any task whose use case moves a caregiver further |
| `src/ui/progress-bar.tsx` | T-041 | — |
| `src/db/repositories/pipeline-transitions.ts` (sole writer of `Caregiver.stage`, ADR-073) | T-044 | T-041, T-100, T-111, T-124 |
| `src/integrations/adapters/esign/` | T-052 | T-064 |
| `src/integrations/adapters/extraction/` | T-053 | T-071 |
| `src/integrations/adapters/judge/` | T-054 | T-073 |
| `src/integrations/adapters/backgroundCheck/` | T-055 | T-081 |
| `src/app/dev/` (`*.dev.tsx`, dev-only; ADR-011, ADR-040) | T-040, T-052 | T-051, T-081 |
| `src/db/seeds/` | T-077 | T-033, T-132 |
| `src/app/(staff)/admin/issuers/` | T-077 | — |
| `src/server/auth/session.ts` | T-020 | T-021, T-023 |
| `src/app/login/` | T-020 | T-023 |
| `src/lib/totp.ts`, `src/lib/recovery-code.ts`, `src/domain/auth/mfa.ts`, `src/db/repositories/staff-mfa.ts`, `src/app/login/mfa/` | T-023 | — |
| `src/app/(staff)/layout.tsx` | T-020 | — |
| `src/db/repositories/users.ts` | T-020 | T-024 |
| `src/server/auth/link-token.ts` | T-022 | T-044, T-082 |
| `src/server/auth/policy.ts` | T-014 | every task adds its actions |
| `src/domain/auth/role.ts` | T-014 | — |
| `src/app/(staff)/queue/` | T-121 | T-123 |
| `src/domain/documents/weekly-sample.ts`, `src/db/repositories/weekly-sample.ts`, `src/server/review/weekly-sample.ts`, `src/app/(staff)/sample/` | T-075 | — |
| `src/app/_lib/judge-review.ts` (judge and identity copy shared by `/queue` and `/sample`) | T-075 | T-121, T-123 |
| `src/db/repositories/verification.ts` | T-101 | every writer of SATISFIED calls `applyVerificationCompleted` (ADR-113) |
| `src/server/sync/alayacare-sync-job.ts` (job type T-101, handler T-111), `src/domain/sync/alayacare-sync.ts`, `src/db/repositories/alayacare-sync.ts` | T-111 | T-112, T-113, T-115 (read `listAlayaCareSyncs`, `startAlayaCareSync`) |
| `src/app/(staff)/caregivers/[id]/alayacare/`, `src/server/sync/alayacare-source.ts`, `src/server/sync/alayacare-preview.ts`, `src/domain/sync/alayacare-preview.ts` | T-112 | T-111's `runAlayaCareSync` imports `toSyncSourceCredential` from `alayacare-source.ts` (ADR-136) |
| `src/domain/sync/alayacare-conflict.ts`, `src/db/repositories/alayacare-sync-issues.ts`, `src/server/sync/alayacare-sync-issues.ts`, `src/app/(staff)/sync/` | T-113 | — |
| `src/integrations/adapters/alayacare/export.ts` | T-114 | — |
| `src/domain/requirements/clearance.ts`, `src/db/repositories/clearance.ts`, `src/server/clearance/`, `src/app/(staff)/clearance/` | T-100 | T-101 (sign-off: `src/server/clearance/sign-off.ts`, `src/app/(staff)/clearance/sign-off-clearance.tsx`; imports `clearanceReadiness`, `findClearanceSheet`, `isOutstandingBlocker` exported from `blocker.ts`) |
| `src/domain/documents/staff-decision.ts`, `src/domain/requirements/document-review.ts`, `src/db/repositories/staff-decisions.ts`, `src/db/repositories/document-review.ts`, `src/server/review/exception-resolution.ts`, `src/server/review/caregiver-notice-job.ts`, `src/app/(staff)/queue/` actions | T-123 | any writer of SATISFIED on a DOCUMENT instance calls `applyDocumentReviewCleared` (ADR-111) |
| `src/ui/` | T-003 | any task needing a new primitive |
| `mock-servers/alayacare/` | T-056 | — |
| `src/app/_lib/` | T-032 | any task presenting a domain union |
| `src/domain/requirements/credential.ts`, `src/db/repositories/credentials.ts`, `src/server/credentials/` | T-102 | T-101 (calls `recordCaregiverCredentials`), T-115 (`findCaregiverCredentials`) |
| `src/domain/documents/exception-queue.ts`, `src/db/repositories/exception-queue.ts`, `src/server/review/exception-queue.ts` | T-121 | T-123 (actions on `getExceptionQueue` items), T-075 (reuses `DOCUMENT_SELECT` / `toQueueDocument`) |
| `src/domain/eeoc/aggregate-report.ts`, `readEeocAggregateReport` in `src/db/restricted/eeoc.ts`, `src/server/reports/eeoc-report.ts`, `src/app/(staff)/reports/eeoc/` | T-140 | — |
| `src/domain/reports/success-metrics.ts`, `src/db/repositories/success-metrics.ts`, `src/server/reports/success-metrics.ts`, `src/app/(staff)/reports/metrics/` | T-141 | any task adding a staff correction of a caregiver-supplied field (appends to `STAFF_RETYPED_FIELDS`); any task pruning Job rows (ADR-159) |
| `src/domain/auth/staff-user.ts`, `src/server/users/`, `src/app/(staff)/admin/users/`, `src/app/r/staff-invite/`, `src/app/_lib/staff-role.ts` | T-024 | T-023 (MFA at the set-password sign-in) |
| `src/domain/requirements/template-admin.ts`, `src/db/repositories/requirement-template-admin.ts`, `src/server/requirements/`, `src/app/(staff)/admin/requirements/` | T-034 | — (the only UI writer of `RequirementTemplate`; agency rows only, ADR-148) |
| `src/domain/requirements/training-hours.ts`, `src/db/repositories/training.ts`, `src/server/training/`, `src/app/(staff)/training/` | T-090 | — (the only caller of `getPort('training')` is `training-import-job.ts`; ADR-151, ADR-152) |

## Files that many tasks touch

Three files are edited by nearly every task. Append, never restructure:

- `prisma/schema.prisma` — one model group per task, in the section its task owns.
- `src/server/auth/policy.ts` — every use case registers its action and the roles allowed.
- `src/lib/env.ts` — every new env var is added to the zod schema and to `.env.example`.
- `src/integrations/registry.ts` — **T-050 pre-declares every port slot and env var**, so the
  eight concurrent adapter tasks in wave 5 fill an existing slot instead of appending to the
  same lines. Do not add a slot here outside T-050 without an ADR.

Because these are shared, a task that changes one must say so in its `REVIEW.md`.
