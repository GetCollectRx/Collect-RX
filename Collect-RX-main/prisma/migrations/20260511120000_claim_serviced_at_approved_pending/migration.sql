-- Claim appeal deadlines: real date of service (optional, backfill from PMS).
-- Claim lifecycle: carrier approved but payment not yet received (first-class status).
-- Safe when Phase 5 enums/tables are not yet present (e.g. DB only had core Practice tables).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'claim_status'
        AND e.enumlabel = 'APPROVED_PENDING_PAYMENT'
    ) THEN
      ALTER TYPE claim_status ADD VALUE 'APPROVED_PENDING_PAYMENT';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'insurance_claims'
  ) THEN
    EXECUTE 'ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS serviced_at TIMESTAMPTZ NULL';
    EXECUTE format(
      'COMMENT ON COLUMN insurance_claims.serviced_at IS %L',
      'Date of service for the claim — use for carrier appeal deadlines. When NULL, priority engine falls back to referenceDate minus days_outstanding.'
    );
  END IF;
END $$;
