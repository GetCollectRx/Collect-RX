-- AR Brain roadmap: PMS import audit, unified work queue, daily AR close

CREATE TYPE "work_item_type" AS ENUM ('insurance', 'patient_ar', 'outreach');
CREATE TYPE "work_item_source" AS ENUM ('insurance_claim', 'patient_balance', 'outreach_balance');

CREATE TABLE "pms_import_runs" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "pms_source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "records_total" INTEGER NOT NULL DEFAULT 0,
    "records_imported" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "source_record_count" INTEGER,
    "source_balance_total" DECIMAL(14,2),
    "imported_balance_total" DECIMAL(14,2),
    "drift_pct" DOUBLE PRECISION,
    "validation_passed" BOOLEAN,
    "error_log" JSONB,

    CONSTRAINT "pms_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "source_type" "work_item_source" NOT NULL,
    "source_id" TEXT NOT NULL,
    "item_type" "work_item_type" NOT NULL,
    "dollars_at_risk" DECIMAL(12,2) NOT NULL,
    "days_outstanding" INTEGER NOT NULL DEFAULT 0,
    "carrier_id" "carrier_id",
    "title" TEXT,
    "assigned_rep" TEXT,
    "follow_up_at" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rank_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_close_runs" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "close_date" DATE NOT NULL,
    "queue_open_total" DECIMAL(14,2) NOT NULL,
    "payments_received" DECIMAL(14,2) NOT NULL,
    "pms_ledger_total" DECIMAL(14,2),
    "variance_pct" DOUBLE PRECISION NOT NULL,
    "validation_passed" BOOLEAN NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_close_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pms_import_runs_practice_id_started_at_idx" ON "pms_import_runs"("practice_id", "started_at" DESC);
CREATE UNIQUE INDEX "work_items_practice_id_source_type_source_id_key" ON "work_items"("practice_id", "source_type", "source_id");
CREATE INDEX "work_items_practice_id_status_rank_score_idx" ON "work_items"("practice_id", "status", "rank_score" DESC);
CREATE INDEX "work_items_practice_id_assigned_rep_idx" ON "work_items"("practice_id", "assigned_rep");
CREATE UNIQUE INDEX "ar_close_runs_practice_id_close_date_key" ON "ar_close_runs"("practice_id", "close_date");
CREATE INDEX "ar_close_runs_practice_id_close_date_idx" ON "ar_close_runs"("practice_id", "close_date" DESC);
