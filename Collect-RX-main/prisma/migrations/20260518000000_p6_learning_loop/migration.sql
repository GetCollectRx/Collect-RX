-- Phase 6: Learning & implementation loop

CREATE TYPE "learning_bucket" AS ENUM ('PRODUCT', 'ENGINEERING', 'OPS', 'GROWTH', 'COMPLIANCE');
CREATE TYPE "learning_candidate_status" AS ENUM ('RESEARCHED', 'RANKED', 'IMPLEMENTED', 'SKIPPED', 'FAILED');

CREATE TABLE "learning_cycle_runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "pulled_count" INTEGER NOT NULL DEFAULT 0,
    "researched_count" INTEGER NOT NULL DEFAULT 0,
    "ranked_count" INTEGER NOT NULL DEFAULT 0,
    "implemented_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "sms_sent" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "learning_cycle_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_candidates" (
    "id" TEXT NOT NULL,
    "cycle_run_id" TEXT NOT NULL,
    "notion_page_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bucket" "learning_bucket",
    "rank_score" DOUBLE PRECISION,
    "feasibility_score" DOUBLE PRECISION,
    "status" "learning_candidate_status" NOT NULL DEFAULT 'RESEARCHED',
    "research_notes" JSONB,
    "implementation_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_cycle_runs_started_at_idx" ON "learning_cycle_runs"("started_at" DESC);
CREATE INDEX "learning_candidates_cycle_run_id_rank_score_idx" ON "learning_candidates"("cycle_run_id", "rank_score" DESC);
CREATE UNIQUE INDEX "learning_candidates_cycle_run_id_notion_page_id_key" ON "learning_candidates"("cycle_run_id", "notion_page_id");

ALTER TABLE "learning_candidates" ADD CONSTRAINT "learning_candidates_cycle_run_id_fkey" FOREIGN KEY ("cycle_run_id") REFERENCES "learning_cycle_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
