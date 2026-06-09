-- CDCP reconsideration submission fields (adjudicator rotation, confirmation, etc.)
ALTER TABLE "CdcpReconsiderationCase" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
