-- Tenant-isolate eligibility_snapshots + index PatientBalance.patientPhone (Twilio STOP/HELP lookup).
-- When eligibility_snapshots does not exist yet (DB never ran Phase 3 SQL), skip that section so deploy succeeds.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'eligibility_snapshots'
  ) THEN
    ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS practice_id TEXT;

    UPDATE eligibility_snapshots AS es
    SET practice_id = p."practiceId"
    FROM "Patient" AS p
    WHERE es.patient_id = p."id"
      AND es.practice_id IS NULL;

    UPDATE eligibility_snapshots AS es
    SET practice_id = pb."practiceId"
    FROM "PatientBalance" AS pb
    WHERE es.practice_id IS NULL
      AND pb."abeldentPatientId" IS NOT NULL
      AND es.patient_id = pb."abeldentPatientId"
      AND pb."practiceId" IS NOT NULL;

    DELETE FROM eligibility_snapshots WHERE practice_id IS NULL;

    ALTER TABLE eligibility_snapshots ALTER COLUMN practice_id SET NOT NULL;

    DROP INDEX IF EXISTS eligibility_snapshots_patient_id_carrier_verified_at_idx;
    DROP INDEX IF EXISTS idx_eligibility_snapshots_patient_carrier;

    CREATE INDEX IF NOT EXISTS eligibility_snapshots_practice_id_patient_id_carrier_verified_at_idx
      ON eligibility_snapshots (practice_id, patient_id, carrier, verified_at DESC);

    ALTER TABLE eligibility_snapshots DROP CONSTRAINT IF EXISTS eligibility_snapshots_practice_id_fkey;

    ALTER TABLE eligibility_snapshots
      ADD CONSTRAINT eligibility_snapshots_practice_id_fkey
      FOREIGN KEY (practice_id) REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ELSE
    RAISE NOTICE 'Skipping eligibility_snapshots tenant migration: table not present.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'PatientBalance'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "PatientBalance_patientPhone_idx" ON "PatientBalance" ("patientPhone")';
  END IF;
END $$;
