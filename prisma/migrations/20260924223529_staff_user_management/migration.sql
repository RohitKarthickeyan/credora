-- AlterEnum
ALTER TYPE "core"."AuditEntityType" ADD VALUE 'USER';

-- AlterEnum
ALTER TYPE "core"."LinkTokenPurpose" ADD VALUE 'STAFF_INVITE';

-- AlterTable
ALTER TABLE "core"."LinkToken" ALTER COLUMN "caregiverId" DROP NOT NULL;

-- Hand-written below Prisma's DDL (T-024 Design 3); Prisma does not introspect CHECKs. A staff
-- invite's subject is a User, so it has no caregiver; every other purpose's does. Compared as
-- text because Postgres refuses to use an enum value added in the same transaction.
ALTER TABLE "core"."LinkToken" ADD CONSTRAINT "LinkToken_caregiver_iff_not_staff_invite"
  CHECK (("purpose"::text = 'STAFF_INVITE') = ("caregiverId" IS NULL));
