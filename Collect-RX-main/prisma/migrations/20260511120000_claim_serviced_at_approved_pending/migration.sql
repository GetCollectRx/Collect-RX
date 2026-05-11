-- Claim appeal deadlines: real date of service (optional, backfill from PMS).
-- Claim lifecycle: carrier approved but payment not yet received (first-class status).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status'
      AND e.enumlabel = 'APPROVED_PENDING_PAYMENT'
  ) THEN
    ALTER TYPE claim_status ADD VALUE 'APPROVED_PENDING_PAYMENT';
  END IF;
END $$;

ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS serviced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN insurance_claims.serviced_at IS
  'Date of service for the claim — use for carrier appeal deadlines. When NULL, priority engine falls back to referenceDate minus days_outstanding.';
