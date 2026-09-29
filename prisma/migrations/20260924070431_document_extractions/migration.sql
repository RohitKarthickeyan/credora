-- CreateTable
CREATE TABLE "core"."Extraction" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "fields" JSONB NOT NULL,
    "text" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical"."ClinicalDocumentText" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocumentText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_uploadedDocumentId_key" ON "core"."Extraction"("uploadedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_agencyId_uploadedDocumentId_key" ON "core"."Extraction"("agencyId", "uploadedDocumentId");

-- CreateIndex
CREATE INDEX "ClinicalDocumentText_agencyId_caregiverId_idx" ON "medical"."ClinicalDocumentText"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalDocumentText_agencyId_uploadedDocumentId_key" ON "medical"."ClinicalDocumentText"("agencyId", "uploadedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedDocument_agencyId_id_key" ON "core"."UploadedDocument"("agencyId", "id");

-- AddForeignKey
ALTER TABLE "core"."Extraction" ADD CONSTRAINT "Extraction_agencyId_uploadedDocumentId_fkey" FOREIGN KEY ("agencyId", "uploadedDocumentId") REFERENCES "core"."UploadedDocument"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
