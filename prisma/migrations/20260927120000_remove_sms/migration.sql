-- Credora sends no text messages (ADR-161). Rows that cannot survive the type changes are dev-only:
-- mock SMS sends in the outbox, email-verification links, and notices cancelled for SMS reasons.
DELETE FROM "core"."SentMessage" WHERE "channel" = 'sms' OR "subject" IS NULL;
DELETE FROM "core"."LinkToken" WHERE "purpose" = 'EMAIL_VERIFICATION';
UPDATE "core"."StaffDocumentDecision" SET "caregiverNotice" = 'CANCELLED' WHERE "caregiverNotice" IN ('NO_SMS_CONSENT', 'NO_MOBILE_PHONE');

-- AlterEnum
BEGIN;
CREATE TYPE "core"."CaregiverNoticeStatus_new" AS ENUM ('QUEUED', 'SENT', 'REJECTED', 'NO_EMAIL', 'CANCELLED');
ALTER TABLE "core"."StaffDocumentDecision" ALTER COLUMN "caregiverNotice" TYPE "core"."CaregiverNoticeStatus_new" USING ("caregiverNotice"::text::"core"."CaregiverNoticeStatus_new");
ALTER TYPE "core"."CaregiverNoticeStatus" RENAME TO "CaregiverNoticeStatus_old";
ALTER TYPE "core"."CaregiverNoticeStatus_new" RENAME TO "CaregiverNoticeStatus";
DROP TYPE "core"."CaregiverNoticeStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "core"."LinkTokenPurpose_new" AS ENUM ('INVITE', 'REFERENCE_FORM', 'STAFF_INVITE');
ALTER TABLE "core"."LinkToken" ALTER COLUMN "purpose" TYPE "core"."LinkTokenPurpose_new" USING ("purpose"::text::"core"."LinkTokenPurpose_new");
ALTER TYPE "core"."LinkTokenPurpose" RENAME TO "LinkTokenPurpose_old";
ALTER TYPE "core"."LinkTokenPurpose_new" RENAME TO "LinkTokenPurpose";
DROP TYPE "core"."LinkTokenPurpose_old";
COMMIT;

-- DropIndex
DROP INDEX "core"."ContactRecord_mobilePhone_idx";

-- AlterTable
ALTER TABLE "core"."ContactRecord" DROP COLUMN "emailVerificationSentTo",
DROP COLUMN "emailVerifiedAt",
DROP COLUMN "smsConsent",
DROP COLUMN "smsConsentAt";

-- AlterTable
ALTER TABLE "core"."ReferenceAttempt" DROP COLUMN "sentChannels";

-- AlterTable
ALTER TABLE "core"."SentMessage" DROP COLUMN "channel",
ALTER COLUMN "subject" SET NOT NULL;

-- DropEnum
DROP TYPE "core"."MessageChannel";

-- CreateIndex
CREATE INDEX "ContactRecord_email_idx" ON "core"."ContactRecord"("email");

