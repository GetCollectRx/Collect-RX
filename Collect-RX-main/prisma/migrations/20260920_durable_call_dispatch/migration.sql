-- Persist outbound intent before crossing the Vapi network boundary. An
-- uncertain SENDING intent is held for reconciliation rather than redialled.
CREATE TABLE "call_dispatch_intents" (
  "id" TEXT NOT NULL,
  "practice_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "queue_entry_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "vapi_call_id" TEXT,
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "send_started_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "reconciled_at" TIMESTAMP(3),
  CONSTRAINT "call_dispatch_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_dispatch_intents_idempotency_key_key" ON "call_dispatch_intents"("idempotency_key");
CREATE UNIQUE INDEX "call_dispatch_intents_vapi_call_id_key" ON "call_dispatch_intents"("vapi_call_id");
CREATE UNIQUE INDEX "call_dispatch_intents_queue_entry_id_attempt_number_key" ON "call_dispatch_intents"("queue_entry_id", "attempt_number");
CREATE INDEX "call_dispatch_intents_practice_id_status_updated_at_idx" ON "call_dispatch_intents"("practice_id", "status", "updated_at");
CREATE INDEX "call_dispatch_intents_claim_id_created_at_idx" ON "call_dispatch_intents"("claim_id", "created_at" DESC);

ALTER TABLE "call_attempts" ADD COLUMN "dispatch_intent_id" TEXT;
CREATE UNIQUE INDEX "call_attempts_dispatch_intent_id_key" ON "call_attempts"("dispatch_intent_id");
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_dispatch_intent_id_fkey"
  FOREIGN KEY ("dispatch_intent_id") REFERENCES "call_dispatch_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
