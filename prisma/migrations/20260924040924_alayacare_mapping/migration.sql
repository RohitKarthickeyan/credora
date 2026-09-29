-- AlterEnum
ALTER TYPE "core"."AuditEntityType" ADD VALUE 'ALAYACARE_MAPPING';

-- CreateTable
CREATE TABLE "core"."AlayaCareMapping" (
    "agencyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlayaCareMapping_pkey" PRIMARY KEY ("agencyId")
);

-- AddForeignKey
ALTER TABLE "core"."AlayaCareMapping" ADD CONSTRAINT "AlayaCareMapping_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
