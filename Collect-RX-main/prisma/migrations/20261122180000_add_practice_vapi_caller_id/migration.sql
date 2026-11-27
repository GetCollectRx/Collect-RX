-- Per-practice caller ID. Additive and nullable: existing practices keep using the
-- shared CollectRx Vapi number until a practice number is registered and authorized.
ALTER TABLE "Practice"
  ADD COLUMN IF NOT EXISTS "vapi_phone_number_id" TEXT,
  ADD COLUMN IF NOT EXISTS "caller_id_authorized_at" TIMESTAMP(3);
