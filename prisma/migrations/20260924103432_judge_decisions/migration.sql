-- CreateEnum
CREATE TYPE "core"."JudgeVerdict" AS ENUM ('VALID', 'INVALID', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "core"."JudgeStaffReason" AS ENUM ('MANUAL_ONLY', 'EXPIRED', 'EXPIRY_UNKNOWN', 'ISSUED_IN_FUTURE', 'ISSUED_AFTER_EXPIRY', 'VERDICT_INVALID', 'VERDICT_UNCERTAIN', 'LOW_JUDGE_CONFIDENCE', 'MOCK_VERDICT_WITHOUT_ALLOWLIST');

-- CreateTable
CREATE TABLE "core"."JudgeDecision" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "matchedIssuerId" TEXT,
    "matchedIssuerName" TEXT,
    "inputHash" TEXT,
    "verdict" "core"."JudgeVerdict",
    "confidence" DOUBLE PRECISION,
    "modelVersion" TEXT,
    "reasons" TEXT[],
    "staffReasons" "core"."JudgeStaffReason"[],
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical"."ClinicalJudgeReasons" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "uploadedDocumentId" TEXT NOT NULL,
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalJudgeReasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JudgeDecision_uploadedDocumentId_key" ON "core"."JudgeDecision"("uploadedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeDecision_agencyId_uploadedDocumentId_key" ON "core"."JudgeDecision"("agencyId", "uploadedDocumentId");

-- CreateIndex
CREATE INDEX "ClinicalJudgeReasons_agencyId_caregiverId_idx" ON "medical"."ClinicalJudgeReasons"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalJudgeReasons_agencyId_uploadedDocumentId_key" ON "medical"."ClinicalJudgeReasons"("agencyId", "uploadedDocumentId");

-- AddForeignKey
ALTER TABLE "core"."JudgeDecision" ADD CONSTRAINT "JudgeDecision_agencyId_uploadedDocumentId_fkey" FOREIGN KEY ("agencyId", "uploadedDocumentId") REFERENCES "core"."UploadedDocument"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
