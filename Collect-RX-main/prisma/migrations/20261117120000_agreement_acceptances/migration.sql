-- Signed record of agreement acceptance (pilot item B3 / R1). One row per
-- user, agreement kind and version. Rows are append-only: UPDATE is rejected
-- by trigger so a stored acceptance can never be rewritten to a later version.
CREATE TABLE "agreement_acceptances" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'signup',
  CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreement_acceptances_user_id_kind_version_key" ON "agreement_acceptances"("user_id", "kind", "version");
CREATE INDEX "agreement_acceptances_practice_id_kind_idx" ON "agreement_acceptances"("practice_id", "kind");

ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION agreement_acceptances_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agreement_acceptances rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_acceptances_no_update
  BEFORE UPDATE ON "agreement_acceptances"
  FOR EACH ROW EXECUTE FUNCTION agreement_acceptances_reject_update();

ALTER TABLE "agreement_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreement_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agreement_acceptances"
  FOR ALL USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));
