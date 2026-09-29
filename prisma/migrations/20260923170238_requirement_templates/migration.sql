-- CreateEnum
CREATE TYPE "core"."RequirementLayer" AS ENUM ('STATE', 'SERVICE_TYPE', 'PAYER', 'AGENCY');

-- CreateEnum
CREATE TYPE "core"."RequirementType" AS ENUM ('FORM', 'DOCUMENT', 'CHECK', 'TRAINING', 'ATTESTATION');

-- CreateEnum
CREATE TYPE "core"."EvidenceKind" AS ENUM ('UPLOADED_DOCUMENT', 'SIGNED_DOCUMENT', 'CHECK_RESULT', 'TRAINING_RECORD', 'ATTESTATION');

-- CreateEnum
CREATE TYPE "core"."ValidityRule" AS ENUM ('NEVER_EXPIRES', 'FROM_EVIDENCE', 'FIXED_PERIOD');

-- CreateEnum
CREATE TYPE "core"."RenewalRule" AS ENUM ('NONE', 'ON_EXPIRY', 'ANNUAL');

-- CreateTable
CREATE TABLE "core"."RequirementTemplate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT,
    "state" TEXT,
    "serviceType" TEXT,
    "payer" TEXT,
    "layer" "core"."RequirementLayer" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "core"."RequirementType" NOT NULL,
    "validityRule" "core"."ValidityRule" NOT NULL,
    "validityMonths" INTEGER,
    "renewalRule" "core"."RenewalRule" NOT NULL,
    "blocksClearance" BOOLEAN NOT NULL DEFAULT true,
    "manualOnly" BOOLEAN NOT NULL DEFAULT false,
    "manualOnlyReason" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AcceptedEvidence" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT,
    "templateId" TEXT NOT NULL,
    "kind" "core"."EvidenceKind" NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptedEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementTemplate_agencyId_key_idx" ON "core"."RequirementTemplate"("agencyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementTemplate_scopeKey_key_version_key" ON "core"."RequirementTemplate"("scopeKey", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptedEvidence_templateId_evidenceKey_key" ON "core"."AcceptedEvidence"("templateId", "evidenceKey");

-- AddForeignKey
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."AcceptedEvidence" ADD CONSTRAINT "AcceptedEvidence_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "core"."RequirementTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The four statements below are hand-written (T-030 § Design 2). Prisma 7 cannot express a
-- CHECK constraint or a partial unique index in the PSL, and does not introspect either, so
-- they neither appear in schema.prisma nor read as drift.

-- layer is the narrowest non-null axis. Derived rather than asserted means the two cannot
-- disagree; T-036 replaces this constraint when it adds the role axis.
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_layer_matches_scope"
  CHECK ("layer" = (CASE
    WHEN "agencyId"    IS NOT NULL THEN 'AGENCY'
    WHEN "payer"       IS NOT NULL THEN 'PAYER'
    WHEN "serviceType" IS NOT NULL THEN 'SERVICE_TYPE'
    ELSE 'STATE' END)::"core"."RequirementLayer");

-- A step kept away from automation must name the regulation that keeps it there
-- (SECURITY.md § Regulatory constraints that shape code).
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_manual_only_reason"
  CHECK ("manualOnly" = false OR "manualOnlyReason" IS NOT NULL);

-- A period exists exactly when the rule is FIXED_PERIOD, and it is positive.
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_validity_months"
  CHECK (("validityRule" = 'FIXED_PERIOD'::"core"."ValidityRule") = ("validityMonths" IS NOT NULL)
         AND ("validityMonths" IS NULL OR "validityMonths" > 0));

-- At most one live version per (scopeKey, key). Without it two live versions of the same rule
-- make resolution non-deterministic.
CREATE UNIQUE INDEX "RequirementTemplate_live_version"
  ON "core"."RequirementTemplate" ("scopeKey", "key") WHERE "retiredAt" IS NULL;
