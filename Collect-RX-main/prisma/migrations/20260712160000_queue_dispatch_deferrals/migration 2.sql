-- Add only safe, structured dispatch state. Existing queue rows remain valid.
ALTER TABLE "call_queue"
  ADD COLUMN "dispatch_deferral_code" TEXT,
  ADD COLUMN "dispatch_deferral_next_action" TEXT,
  ADD COLUMN "dispatch_deferred_at" TIMESTAMP(3);
