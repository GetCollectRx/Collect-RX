-- DEC-9 (b): staff checkpoint at first use per practice and carrier.
-- Additive only: two new tables and one enum. No change to existing rows, and
-- nothing is enforced until the dispatch.approval_checkpoint flag is turned on.

CREATE TYPE "dispatch_checkpoint_status" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

CREATE TABLE "dispatch_checkpoints" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "carrier_id" "carrier_id" NOT NULL,
  "status" "dispatch_checkpoint_status" NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_user_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "notes" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dispatch_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatch_checkpoints_practice_id_carrier_id_key" ON "dispatch_checkpoints"("practice_id", "carrier_id");
CREATE INDEX "dispatch_checkpoints_practice_id_status_idx" ON "dispatch_checkpoints"("practice_id", "status");

CREATE TABLE "dispatch_checkpoint_events" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "checkpoint_id" TEXT NOT NULL,
  "carrier_id" "carrier_id" NOT NULL,
  "action" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "queued_claims_at_decision" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_checkpoint_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dispatch_checkpoint_events_practice_id_created_at_idx" ON "dispatch_checkpoint_events"("practice_id", "created_at");
CREATE INDEX "dispatch_checkpoint_events_checkpoint_id_created_at_idx" ON "dispatch_checkpoint_events"("checkpoint_id", "created_at");

-- Append-only audit trail: reject UPDATE and DELETE on events.
CREATE OR REPLACE FUNCTION dispatch_checkpoint_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dispatch_checkpoint_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispatch_checkpoint_events_no_update
  BEFORE UPDATE OR DELETE ON "dispatch_checkpoint_events"
  FOR EACH ROW EXECUTE FUNCTION dispatch_checkpoint_events_append_only();

-- Tenant isolation, same policy shape as the other practice-scoped tables.
ALTER TABLE "dispatch_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dispatch_checkpoints" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dispatch_checkpoints";
CREATE POLICY tenant_isolation ON "dispatch_checkpoints"
  FOR ALL USING (app_rls_practice_allowed("practice_id")) WITH CHECK (app_rls_practice_allowed("practice_id"));

ALTER TABLE "dispatch_checkpoint_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dispatch_checkpoint_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dispatch_checkpoint_events";
CREATE POLICY tenant_isolation ON "dispatch_checkpoint_events"
  FOR ALL USING (app_rls_practice_allowed("practice_id")) WITH CHECK (app_rls_practice_allowed("practice_id"));
