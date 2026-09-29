-- CreateEnum
CREATE TYPE "core"."AutoAcceptStaffReason" AS ENUM ('MANUAL_ONLY', 'EXTRACTION_NOT_CONFIDENT', 'IDENTITY_NOT_MATCHED', 'JUDGE_NOT_RUN', 'JUDGE_NOT_PASSED');

-- CreateEnum
CREATE TYPE "core"."IdentityOutcome" AS ENUM ('AGREES', 'AGREES_WITH_OTHER_NAME', 'DIFFERS', 'UNREADABLE', 'NOT_PRINTED', 'NOT_ON_INTAKE');

-- CreateTable
CREATE TABLE "core"."AutoAcceptDecision" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "staffReasons" "core"."AutoAcceptStaffReason"[],
    "fullNameOutcome" "core"."IdentityOutcome" NOT NULL,
    "dateOfBirthOutcome" "core"."IdentityOutcome" NOT NULL,
    "instanceStatusSet" "core"."InstanceStatus",
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoAcceptDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutoAcceptDecision_uploadedDocumentId_key" ON "core"."AutoAcceptDecision"("uploadedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoAcceptDecision_agencyId_uploadedDocumentId_key" ON "core"."AutoAcceptDecision"("agencyId", "uploadedDocumentId");

-- AddForeignKey
ALTER TABLE "core"."AutoAcceptDecision" ADD CONSTRAINT "AutoAcceptDecision_agencyId_uploadedDocumentId_fkey" FOREIGN KEY ("agencyId", "uploadedDocumentId") REFERENCES "core"."UploadedDocument"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
