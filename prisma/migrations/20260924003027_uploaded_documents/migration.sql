-- AlterTable
ALTER TABLE "core"."Evidence" ADD COLUMN     "uploadedDocumentId" TEXT;

-- CreateTable
CREATE TABLE "core"."UploadedDocument" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadedDocument_storageKey_key" ON "core"."UploadedDocument"("storageKey");

-- CreateIndex
CREATE INDEX "UploadedDocument_agencyId_caregiverId_idx" ON "core"."UploadedDocument"("agencyId", "caregiverId");

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_uploadedDocumentId_fkey" FOREIGN KEY ("uploadedDocumentId") REFERENCES "core"."UploadedDocument"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."UploadedDocument" ADD CONSTRAINT "UploadedDocument_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every evidence source column that exists, plus this arm's (ADR-028).
ALTER TABLE core."Evidence" DROP CONSTRAINT "Evidence_exactly_one_source";
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_exactly_one_source"
  CHECK (num_nonnulls("signedDocumentId", "uploadedDocumentId") = 1);

ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_uploaded_document_source"
  CHECK (("kind" = 'UPLOADED_DOCUMENT'::core."EvidenceKind") = ("uploadedDocumentId" IS NOT NULL));

-- Postgres runs each cascade as its own statement, so a caregiver delete checks this FK before Evidence's cascade has run.
ALTER TABLE "core"."Evidence" ALTER CONSTRAINT "Evidence_uploadedDocumentId_fkey" DEFERRABLE INITIALLY DEFERRED;
