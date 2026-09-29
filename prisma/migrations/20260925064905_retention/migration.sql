-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "core"."AuditEntityType" ADD VALUE 'INBOUND_WEBHOOK';
ALTER TYPE "core"."AuditEntityType" ADD VALUE 'AUDIT_LOG';

-- AlterTable
ALTER TABLE "core"."EnvelopeDocument" ADD COLUMN     "unsignedPdfDeletedAt" TIMESTAMP(3);
