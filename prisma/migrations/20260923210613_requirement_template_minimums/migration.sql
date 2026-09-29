-- AlterTable
ALTER TABLE "core"."RequirementTemplate" ADD COLUMN     "minimumMinutes" INTEGER;

-- A training minimum is whole minutes, positive, and only on a TRAINING rule.
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_minimum_minutes"
  CHECK ("minimumMinutes" IS NULL
         OR ("type" = 'TRAINING'::"core"."RequirementType" AND "minimumMinutes" > 0));

-- T-030 REVIEW: a whitespace-only reason passed IS NOT NULL. Same name, stricter body.
ALTER TABLE "core"."RequirementTemplate" DROP CONSTRAINT "RequirementTemplate_manual_only_reason";
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_manual_only_reason"
  CHECK ("manualOnly" = false OR btrim(coalesce("manualOnlyReason", '')) <> '');
