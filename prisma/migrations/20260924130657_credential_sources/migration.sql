-- AlterTable
ALTER TABLE "core"."Credential" ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "uploadedDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Credential_agencyId_instanceId_key" ON "core"."Credential"("agencyId", "instanceId");

-- AddForeignKey
ALTER TABLE "core"."Credential" ADD CONSTRAINT "Credential_agencyId_instanceId_fkey" FOREIGN KEY ("agencyId", "instanceId") REFERENCES "core"."RequirementInstance"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Credential" ADD CONSTRAINT "Credential_agencyId_uploadedDocumentId_fkey" FOREIGN KEY ("agencyId", "uploadedDocumentId") REFERENCES "core"."UploadedDocument"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
