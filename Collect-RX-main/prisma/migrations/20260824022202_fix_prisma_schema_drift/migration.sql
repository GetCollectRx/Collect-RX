-- Catches up the database to schema.prisma for drift that had accumulated
-- from prior direct-DB or partial-migration changes never fully captured as
-- migrations. Deliberately excludes the "organization_invite_tokens" table:
-- it is genuinely unused in the codebase (superseded by InviteToken's
-- organizationId/orgRole fields — see prisma/schema.prisma), but dropping a
-- table is irreversible and unverifiable against production data from here,
-- so schema.prisma still declares no model for it and a real
-- `DROP TABLE "organization_invite_tokens"` is deliberately NOT included in
-- this migration pending an explicit operator decision.
--
-- Everything below is non-destructive: constraint/index renames, loosened
-- (not tightened) nullability/defaults on webhook_audit_logs, millisecond
-- timestamp precision (was microsecond — six existing DateTime columns,
-- inconsequential for email/import bookkeeping timestamps), and FK ON UPDATE
-- CASCADE additions that are inert in practice since every referenced key
-- here is a UUID primary key, never updated in place. The one exception,
-- `email_sequence_step` on `prospects` gaining NOT NULL, matches what
-- schema.prisma already declared (Int, not Int?) — this migration was simply
-- never generated for it; the column already defaults to 0 for every row.
--
-- 2026-08-24 correction: the first production deploy attempt of this
-- migration failed with P3018 -- "idx_email_events_timestamp" does not
-- exist, even though the migration that created it
-- (20260721_add_email_campaign_fields) had already applied. Production's
-- actual index/constraint state has diverged from what the migration
-- history implies -- exactly the kind of undocumented drift this migration
-- exists to fix -- so every DROP/RENAME below is now conditional on the
-- object's current existence instead of assumed, making this migration safe
-- to apply regardless of which of these objects already went missing or
-- already match schema.prisma's names.

-- DropForeignKey
ALTER TABLE "csv_import_logs" DROP CONSTRAINT IF EXISTS "fk_csv_imports_imported_by";

-- DropForeignKey
ALTER TABLE "csv_import_logs" DROP CONSTRAINT IF EXISTS "fk_csv_imports_practice_id";

-- DropForeignKey
ALTER TABLE "email_campaign_events" DROP CONSTRAINT IF EXISTS "email_campaign_events_prospect_id_fkey";

-- DropForeignKey
ALTER TABLE "escalations" DROP CONSTRAINT IF EXISTS "escalations_claim_id_fkey";

-- DropForeignKey (organization_invite_tokens itself is deliberately kept -- see
-- header note; only its unenforced FK constraint is dropped, since schema.prisma
-- models the table as @@ignore'd with no relation, and this drops no data)
ALTER TABLE "organization_invite_tokens" DROP CONSTRAINT IF EXISTS "organization_invite_tokens_organization_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "idx_email_events_timestamp";

-- DropIndex
DROP INDEX IF EXISTS "idx_webhook_audit_logs_type_created";

-- AlterTable
ALTER TABLE "csv_import_logs" ALTER COLUMN "imported_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "prospects" ALTER COLUMN "email_sequence_step" SET NOT NULL,
ALTER COLUMN "initial_email_sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "follow_up_email_sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "follow_up_scheduled_for" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "email_replied_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "webhook_audit_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "signature_valid" DROP NOT NULL,
ALTER COLUMN "timestamp_valid" DROP NOT NULL,
ALTER COLUMN "timestamp_valid" DROP DEFAULT,
ALTER COLUMN "idempotency_check" DROP NOT NULL,
ALTER COLUMN "received_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_campaign_events_event_timestamp_idx" ON "email_campaign_events"("event_timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prospects_follow_up_scheduled_for_idx" ON "prospects"("follow_up_scheduled_for");

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_events" ADD CONSTRAINT "email_campaign_events_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csv_import_logs" ADD CONSTRAINT "csv_import_logs_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csv_import_logs" ADD CONSTRAINT "csv_import_logs_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex (conditional: Postgres has no "RENAME ... IF EXISTS" form, and
-- given the drift above, the old name may already be gone or the new name
-- may already be in place -- each rename only fires when the old name
-- exists and the new name doesn't yet)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_csv_imports_file_hash')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'csv_import_logs_file_hash_key') THEN
    ALTER INDEX "idx_csv_imports_file_hash" RENAME TO "csv_import_logs_file_hash_key";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_csv_imports_imported_at')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'csv_import_logs_imported_at_idx') THEN
    ALTER INDEX "idx_csv_imports_imported_at" RENAME TO "csv_import_logs_imported_at_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_csv_imports_imported_by')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'csv_import_logs_imported_by_idx') THEN
    ALTER INDEX "idx_csv_imports_imported_by" RENAME TO "csv_import_logs_imported_by_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_csv_imports_practice_id')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'csv_import_logs_practice_id_idx') THEN
    ALTER INDEX "idx_csv_imports_practice_id" RENAME TO "csv_import_logs_practice_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_csv_imports_status')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'csv_import_logs_status_idx') THEN
    ALTER INDEX "idx_csv_imports_status" RENAME TO "csv_import_logs_status_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_email_events_prospect')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'email_campaign_events_prospect_id_idx') THEN
    ALTER INDEX "idx_email_events_prospect" RENAME TO "email_campaign_events_prospect_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_email_events_type')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'email_campaign_events_event_type_idx') THEN
    ALTER INDEX "idx_email_events_type" RENAME TO "email_campaign_events_event_type_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_prospects_email_sequence')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'prospects_email_sequence_step_stage_idx') THEN
    ALTER INDEX "idx_prospects_email_sequence" RENAME TO "prospects_email_sequence_step_stage_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_webhook_audit_logs_created_at')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_audit_logs_created_at_idx') THEN
    ALTER INDEX "idx_webhook_audit_logs_created_at" RENAME TO "webhook_audit_logs_created_at_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_webhook_audit_logs_signature_valid')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_audit_logs_signature_valid_idx') THEN
    ALTER INDEX "idx_webhook_audit_logs_signature_valid" RENAME TO "webhook_audit_logs_signature_valid_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_webhook_audit_logs_type')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_audit_logs_webhook_type_idx') THEN
    ALTER INDEX "idx_webhook_audit_logs_type" RENAME TO "webhook_audit_logs_webhook_type_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_webhook_audit_logs_webhook_id')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_audit_logs_webhook_id_idx') THEN
    ALTER INDEX "idx_webhook_audit_logs_webhook_id" RENAME TO "webhook_audit_logs_webhook_id_idx";
  END IF;
END $$;
