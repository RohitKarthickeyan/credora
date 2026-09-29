-- AlterEnum
ALTER TYPE "core"."LinkTokenPurpose" ADD VALUE 'EMAIL_VERIFICATION';

-- AlterTable
ALTER TABLE "core"."ContactRecord" ADD COLUMN     "emailVerificationSentTo" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "core"."OneTimeCode" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OneTimeCode_agencyId_caregiverId_createdAt_idx" ON "core"."OneTimeCode"("agencyId", "caregiverId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactRecord_mobilePhone_idx" ON "core"."ContactRecord"("mobilePhone");

-- AddForeignKey
ALTER TABLE "core"."OneTimeCode" ADD CONSTRAINT "OneTimeCode_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
