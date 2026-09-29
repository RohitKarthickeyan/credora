-- AlterTable
ALTER TABLE "core"."Evidence" ADD COLUMN     "attestationId" TEXT;

-- CreateTable
CREATE TABLE "core"."Attestation" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attestation_agencyId_caregiverId_idx" ON "core"."Attestation"("agencyId", "caregiverId");

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "core"."Attestation"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Attestation" ADD CONSTRAINT "Attestation_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every evidence source column that exists, plus this arm's (ADR-028).
ALTER TABLE core."Evidence" DROP CONSTRAINT "Evidence_exactly_one_source";
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_exactly_one_source"
  CHECK (num_nonnulls("signedDocumentId", "uploadedDocumentId", "attestationId") = 1);

ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_attestation_source"
  CHECK (("kind" = 'ATTESTATION'::core."EvidenceKind") = ("attestationId" IS NOT NULL));

-- Postgres runs each cascade as its own statement, so a caregiver delete checks this FK before Evidence's cascade has run.
ALTER TABLE "core"."Evidence" ALTER CONSTRAINT "Evidence_attestationId_fkey" DEFERRABLE INITIALLY DEFERRED;
