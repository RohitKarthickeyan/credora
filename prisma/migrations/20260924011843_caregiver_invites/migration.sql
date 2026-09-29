-- CreateEnum
CREATE TYPE "core"."InviteStatus" AS ENUM ('QUEUED', 'SENT', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "core"."Caregiver" ADD COLUMN     "payer" TEXT,
ADD COLUMN     "serviceType" TEXT,
ADD COLUMN     "workState" TEXT;

-- CreateTable
CREATE TABLE "core"."Invite" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "status" "core"."InviteStatus" NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invite_agencyId_caregiverId_createdAt_idx" ON "core"."Invite"("agencyId", "caregiverId", "createdAt");

-- AddForeignKey
ALTER TABLE "core"."Invite" ADD CONSTRAINT "Invite_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
