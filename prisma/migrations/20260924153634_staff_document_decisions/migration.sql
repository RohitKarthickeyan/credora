-- CreateEnum
CREATE TYPE "core"."StaffDecision" AS ENUM ('ACCEPTED', 'REJECTED', 'REUPLOAD_REQUESTED');

-- CreateEnum
CREATE TYPE "core"."CaregiverNoticeStatus" AS ENUM ('QUEUED', 'SENT', 'REJECTED', 'NO_SMS_CONSENT', 'NO_MOBILE_PHONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "core"."RequirementInstance" ADD COLUMN     "waivedAt" TIMESTAMP(3),
ADD COLUMN     "waivedByUserId" TEXT;

-- CreateTable
CREATE TABLE "core"."StaffDocumentDecision" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "decision" "core"."StaffDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caregiverNotice" "core"."CaregiverNoticeStatus",
    "noticeSettledAt" TIMESTAMP(3),

    CONSTRAINT "StaffDocumentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffDocumentDecision_uploadedDocumentId_key" ON "core"."StaffDocumentDecision"("uploadedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDocumentDecision_agencyId_uploadedDocumentId_key" ON "core"."StaffDocumentDecision"("agencyId", "uploadedDocumentId");

-- AddForeignKey
ALTER TABLE "core"."StaffDocumentDecision" ADD CONSTRAINT "StaffDocumentDecision_agencyId_uploadedDocumentId_fkey" FOREIGN KEY ("agencyId", "uploadedDocumentId") REFERENCES "core"."UploadedDocument"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
