-- CreateEnum
CREATE TYPE "core"."LinkTokenPurpose" AS ENUM ('INVITE', 'REFERENCE_FORM');

-- CreateTable
CREATE TABLE "core"."LinkToken" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "purpose" "core"."LinkTokenPurpose" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkToken_tokenHash_key" ON "core"."LinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LinkToken_agencyId_purpose_subjectId_idx" ON "core"."LinkToken"("agencyId", "purpose", "subjectId");

-- AddForeignKey
ALTER TABLE "core"."LinkToken" ADD CONSTRAINT "LinkToken_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
