-- AlterEnum
-- BEFORE 'PAYER' is hand-written so the database's enum order matches schema.prisma.
ALTER TYPE "core"."RequirementLayer" ADD VALUE 'ROLE' BEFORE 'PAYER';

-- AlterTable
ALTER TABLE "core"."RequirementTemplate" ADD COLUMN     "role" TEXT;

-- T-036: layer is still the narrowest non-null axis, now with role between payer and
-- serviceType. Same name, new body. It compares as text: Postgres rejects using 'ROLE' as an
-- enum value in the transaction that added it ("unsafe use of new value").
ALTER TABLE "core"."RequirementTemplate" DROP CONSTRAINT "RequirementTemplate_layer_matches_scope";
ALTER TABLE "core"."RequirementTemplate" ADD CONSTRAINT "RequirementTemplate_layer_matches_scope"
  CHECK ("layer"::text = CASE
    WHEN "agencyId"    IS NOT NULL THEN 'AGENCY'
    WHEN "payer"       IS NOT NULL THEN 'PAYER'
    WHEN "role"        IS NOT NULL THEN 'ROLE'
    WHEN "serviceType" IS NOT NULL THEN 'SERVICE_TYPE'
    ELSE 'STATE' END);
