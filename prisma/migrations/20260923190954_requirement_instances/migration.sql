-- CreateEnum
CREATE TYPE "core"."InstanceStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'SATISFIED', 'EXCEPTION', 'WAIVED', 'EXPIRED');

-- CreateTable
CREATE TABLE "core"."RequirementInstance" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "core"."InstanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Evidence" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "kind" "core"."EvidenceKind" NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "signedDocumentId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementInstance_agencyId_id_key" ON "core"."RequirementInstance"("agencyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementInstance_agencyId_caregiverId_templateKey_key" ON "core"."RequirementInstance"("agencyId", "caregiverId", "templateKey");

-- CreateIndex
CREATE INDEX "Evidence_agencyId_instanceId_idx" ON "core"."Evidence"("agencyId", "instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementTemplate_id_key_key" ON "core"."RequirementTemplate"("id", "key");

-- AddForeignKey
ALTER TABLE "core"."RequirementInstance" ADD CONSTRAINT "RequirementInstance_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."RequirementInstance" ADD CONSTRAINT "RequirementInstance_templateId_templateKey_fkey" FOREIGN KEY ("templateId", "templateKey") REFERENCES "core"."RequirementTemplate"("id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_agencyId_instanceId_fkey" FOREIGN KEY ("agencyId", "instanceId") REFERENCES "core"."RequirementInstance"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "core"."SignedDocument"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Exactly one evidence source. Each evidence-arm task replaces this constraint with one that
-- lists its new column too (ADR-028).
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_exactly_one_source"
  CHECK (num_nonnulls("signedDocumentId") = 1);

-- The source column agrees with the kind. Each arm adds its own constraint of this shape.
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_signed_document_source"
  CHECK (("kind" = 'SIGNED_DOCUMENT'::core."EvidenceKind") = ("signedDocumentId" IS NOT NULL));
