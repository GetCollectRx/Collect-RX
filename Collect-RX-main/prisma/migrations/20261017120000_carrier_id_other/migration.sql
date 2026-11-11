-- Non-dental payers use carrier_id = 'other' plus insurance_claims.payer_name.
-- Kept in its own migration: PostgreSQL rejects using a newly added enum value
-- (for example in a CHECK constraint) inside the same transaction that added it.
-- 'other' has no entry in CARRIER_PHONE_MAP, so the outbound call allowlist
-- rejects dispatch to it until a verified payer number is added deliberately.
ALTER TYPE "carrier_id" ADD VALUE IF NOT EXISTS 'other';
