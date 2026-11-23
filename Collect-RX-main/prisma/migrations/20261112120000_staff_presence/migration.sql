-- Staff presence: who can take a live carrier rep right now (PRD Epic 4).
--
-- Additive: a new enum and a new table, nothing existing is changed or backfilled.
-- RLS: the table carries practice_id, so it is ENABLE + FORCE RLS with the same
-- practice scope policy as every other tenant table (app_rls_practice_allowed).

CREATE TYPE "staff_presence_status" AS ENUM ('AVAILABLE', 'BUSY', 'OFF');

CREATE TABLE "staff_presence" (
  "id"          TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "status"      "staff_presence_status" NOT NULL DEFAULT 'OFF',
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_presence_practice_id_user_id_key" ON "staff_presence"("practice_id", "user_id");
CREATE INDEX "staff_presence_practice_id_status_updated_at_idx" ON "staff_presence"("practice_id", "status", "updated_at");

ALTER TABLE "staff_presence"
  ADD CONSTRAINT "staff_presence_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "staff_presence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_presence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_presence_practice_scope" ON "staff_presence"
  FOR ALL
  USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));
