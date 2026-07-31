-- Hold-dump ledger: flags call attempts where the carrier parked the agent on
-- hold past the threshold and ended the call with no engagement.
ALTER TABLE "call_attempts" ADD COLUMN "held_then_dumped" BOOLEAN NOT NULL DEFAULT false;
