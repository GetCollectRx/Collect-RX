-- AA-05: insurance_claims.practice_id had no foreign key to "Practice" --
-- multi-tenant claim/practice referential integrity relied entirely on
-- app-layer discipline and RLS, not the database itself.
--
-- Added as NOT VALID first, then validated in a separate statement.
-- NOT VALID skips the initial full-table scan/lock; VALIDATE CONSTRAINT
-- takes only a SHARE UPDATE EXCLUSIVE lock (reads/writes are not blocked)
-- while it scans. On a large production insurance_claims table this keeps
-- the migration from holding a long exclusive lock during `migrate deploy`.
--
-- Before applying to a production database with existing data, confirm
-- there are no orphaned rows -- the VALIDATE CONSTRAINT step will fail
-- until any are fixed or removed:
--   SELECT ic.id, ic.practice_id FROM insurance_claims ic
--   LEFT JOIN "Practice" p ON p.id = ic.practice_id
--   WHERE p.id IS NULL;

ALTER TABLE "insurance_claims"
  ADD CONSTRAINT "insurance_claims_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "Practice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "insurance_claims"
  VALIDATE CONSTRAINT "insurance_claims_practice_id_fkey";
