-- AlterTable
ALTER TABLE "core"."Evidence" ADD COLUMN     "checkResultId" TEXT;

-- CreateTable
CREATE TABLE "core"."CheckResult" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckResult_agencyId_caregiverId_idx" ON "core"."CheckResult"("agencyId", "caregiverId");

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_checkResultId_fkey" FOREIGN KEY ("checkResultId") REFERENCES "core"."CheckResult"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."CheckResult" ADD CONSTRAINT "CheckResult_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every evidence source column that exists, plus this arm's (ADR-028).
ALTER TABLE core."Evidence" DROP CONSTRAINT "Evidence_exactly_one_source";
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_exactly_one_source"
  CHECK (num_nonnulls("signedDocumentId", "uploadedDocumentId", "attestationId", "checkResultId") = 1);

ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_check_result_source"
  CHECK (("kind" = 'CHECK_RESULT'::core."EvidenceKind") = ("checkResultId" IS NOT NULL));

-- Postgres runs each cascade as its own statement, so a caregiver delete checks this FK before Evidence's cascade has run.
ALTER TABLE "core"."Evidence" ALTER CONSTRAINT "Evidence_checkResultId_fkey" DEFERRABLE INITIALLY DEFERRED;
