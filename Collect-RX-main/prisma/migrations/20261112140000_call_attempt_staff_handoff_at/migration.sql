-- Marks call attempts whose carrier leg was handed to practice staff.
-- Additive and nullable: existing rows and writers are unaffected.
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "staff_handoff_at" TIMESTAMP(3);
