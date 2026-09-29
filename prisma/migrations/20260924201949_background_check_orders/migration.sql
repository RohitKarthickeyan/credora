-- CreateEnum
CREATE TYPE "core"."BackgroundCheckOrderStatus" AS ENUM ('REQUESTED', 'ORDERED', 'PENDING', 'CLEAR', 'CONSIDER');

-- AlterTable
ALTER TABLE "core"."Agency" ADD COLUMN     "backgroundCheckPackageCode" TEXT;

-- AlterTable
ALTER TABLE "core"."CheckResult" ALTER COLUMN "recordedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "core"."BackgroundCheckOrder" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packageCode" TEXT NOT NULL,
    "vendorOrderId" TEXT,
    "status" "core"."BackgroundCheckOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "resultAt" TIMESTAMP(3),

    CONSTRAINT "BackgroundCheckOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheckOrder_agencyId_caregiverId_key" ON "core"."BackgroundCheckOrder"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheckOrder_agencyId_vendorOrderId_key" ON "core"."BackgroundCheckOrder"("agencyId", "vendorOrderId");

-- AddForeignKey
ALTER TABLE "core"."BackgroundCheckOrder" ADD CONSTRAINT "BackgroundCheckOrder_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
