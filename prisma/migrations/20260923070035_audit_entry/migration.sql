-- CreateEnum
CREATE TYPE "core"."AuditActorRole" AS ENUM ('CAREGIVER', 'COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN', 'IMPLEMENTATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "core"."AuditAction" AS ENUM ('VIEW', 'EDIT', 'EXPORT', 'SIGN_OFF', 'DELETE');

-- CreateEnum
CREATE TYPE "core"."AuditEntityType" AS ENUM ('CAREGIVER', 'MEDICAL_FILE', 'EEOC_RECORD');

-- CreateTable
CREATE TABLE "core"."AuditEntry" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "core"."AuditActorRole" NOT NULL,
    "action" "core"."AuditAction" NOT NULL,
    "entityType" "core"."AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldName" TEXT,
    "reason" TEXT,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEntry_agencyId_entityType_entityId_at_idx" ON "core"."AuditEntry"("agencyId", "entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditEntry_agencyId_actorId_at_idx" ON "core"."AuditEntry"("agencyId", "actorId", "at");

-- CreateIndex
CREATE INDEX "AuditEntry_agencyId_at_idx" ON "core"."AuditEntry"("agencyId", "at");

-- Hand-written below Prisma's DDL (T-013 Design 2 and Design 4). Prisma introspects
-- tables, columns, indexes, constraints and enums, not triggers, so no generated migration
-- will restore these if they are dropped; src/db/audit.db.test.ts is what notices.

-- (actorRole, actorId) encodes one fact in two columns. SYSTEM with an actorId reads as a
-- human hiding behind the scheduler; a human role with no actorId reads as an unattributable
-- action. Both are exactly what an audit log exists to rule out.
ALTER TABLE "core"."AuditEntry" ADD CONSTRAINT "AuditEntry_system_actor_has_no_id"
  CHECK (("actorRole" = 'SYSTEM') = ("actorId" IS NULL));

-- Append-only, enforced by the database rather than by convention (SECURITY.md Audit log).
-- FOR EACH ROW deliberately: a row trigger does not fire on TRUNCATE, and truncation is how
-- every *.db.test.ts isolates itself (ADR-010).
CREATE OR REPLACE FUNCTION "core".audit_entry_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'core."AuditEntry" is append-only (SECURITY.md Audit log): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_entry_append_only
  BEFORE UPDATE OR DELETE ON "core"."AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION "core".audit_entry_append_only();
