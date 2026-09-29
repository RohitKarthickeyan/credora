-- AlterEnum
ALTER TYPE "core"."AuditEntityType" ADD VALUE 'REQUIREMENT_TEMPLATE';

ALTER TABLE core."RequirementTemplate" DROP CONSTRAINT "RequirementTemplate_manual_only_reason";
ALTER TABLE core."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_manual_only_reason"
  CHECK ("manualOnly" = false OR ("manualOnlyReason" IS NOT NULL AND btrim("manualOnlyReason") <> ''));
