-- Complete tenant-bound referential integrity and database-enforced isolation
-- for the durable dispatch ledger.
ALTER TABLE "call_dispatch_intents" ADD CONSTRAINT "call_dispatch_intents_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_dispatch_intents" ADD CONSTRAINT "call_dispatch_intents_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_dispatch_intents" ADD CONSTRAINT "call_dispatch_intents_queue_entry_id_fkey"
  FOREIGN KEY ("queue_entry_id") REFERENCES "call_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_dispatch_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_dispatch_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "call_dispatch_intents"
  FOR ALL
  USING (app_rls_practice_allowed("practice_id"))
  WITH CHECK (app_rls_practice_allowed("practice_id"));
