-- Metadata-only credential integrity health state. No credential material is added.
ALTER TABLE "triage_credentials"
  ADD COLUMN "last_health_check_at" TIMESTAMP(3),
  ADD COLUMN "last_health_check_status" TEXT,
  ADD COLUMN "last_health_check_error_code" TEXT;

CREATE INDEX "triage_credentials_last_health_check_at_idx"
  ON "triage_credentials"("last_health_check_at");
