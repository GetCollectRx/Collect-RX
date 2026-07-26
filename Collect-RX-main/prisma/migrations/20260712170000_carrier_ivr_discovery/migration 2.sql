-- Platform-wide IVR discovery records. No patient or practice identifiers are
-- retained here; authorization is enforced at the platform-admin API boundary.

CREATE TYPE "carrier_discovery_trigger" AS ENUM ('MONTHLY', 'CARRIER_ISSUE', 'MANUAL');
CREATE TYPE "carrier_discovery_run_status" AS ENUM ('PENDING', 'READY_FOR_OPERATOR', 'COMPLETED', 'CANCELLED');
CREATE TYPE "carrier_navigation_proposal_status" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

CREATE TABLE "carrier_discovery_runs" (
    "id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "trigger" "carrier_discovery_trigger" NOT NULL,
    "status" "carrier_discovery_run_status" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMP(3) NOT NULL,
    "issue_detail" TEXT,
    "requested_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "carrier_discovery_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carrier_navigation_snapshots" (
    "id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "version" INTEGER NOT NULL,
    "navigation" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carrier_navigation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carrier_navigation_proposals" (
    "id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "discovery_run_id" TEXT,
    "base_snapshot_id" TEXT,
    "proposed_navigation" JSONB NOT NULL,
    "proposed_summary" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "carrier_navigation_proposal_status" NOT NULL DEFAULT 'PROPOSED',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_notes" TEXT,
    "published_snapshot_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "carrier_navigation_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "carrier_navigation_snapshots_carrier_id_version_key"
  ON "carrier_navigation_snapshots"("carrier_id", "version");
CREATE UNIQUE INDEX "carrier_navigation_proposals_published_snapshot_id_key"
  ON "carrier_navigation_proposals"("published_snapshot_id");
CREATE INDEX "carrier_discovery_runs_carrier_id_status_due_at_idx"
  ON "carrier_discovery_runs"("carrier_id", "status", "due_at");
CREATE INDEX "carrier_discovery_runs_trigger_created_at_idx"
  ON "carrier_discovery_runs"("trigger", "created_at" DESC);
CREATE INDEX "carrier_navigation_snapshots_carrier_id_published_at_idx"
  ON "carrier_navigation_snapshots"("carrier_id", "published_at" DESC);
CREATE INDEX "carrier_navigation_proposals_carrier_id_status_created_at_idx"
  ON "carrier_navigation_proposals"("carrier_id", "status", "created_at" DESC);
CREATE INDEX "carrier_navigation_proposals_discovery_run_id_idx"
  ON "carrier_navigation_proposals"("discovery_run_id");

ALTER TABLE "carrier_navigation_proposals"
  ADD CONSTRAINT "carrier_navigation_proposals_discovery_run_id_fkey"
  FOREIGN KEY ("discovery_run_id") REFERENCES "carrier_discovery_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carrier_navigation_proposals"
  ADD CONSTRAINT "carrier_navigation_proposals_base_snapshot_id_fkey"
  FOREIGN KEY ("base_snapshot_id") REFERENCES "carrier_navigation_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carrier_navigation_proposals"
  ADD CONSTRAINT "carrier_navigation_proposals_published_snapshot_id_fkey"
  FOREIGN KEY ("published_snapshot_id") REFERENCES "carrier_navigation_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
