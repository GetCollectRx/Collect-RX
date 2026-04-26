-- P4-03: SMS opt-out; P4-05: Vapi webhook idempotency
ALTER TABLE "PatientBalance" ADD COLUMN "smsOptOutAt" TIMESTAMP(3);

CREATE TABLE "ProcessedVapiWebhook" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedVapiWebhook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessedVapiWebhook_bodyHash_key" ON "ProcessedVapiWebhook"("bodyHash");
CREATE INDEX "PatientBalance_smsOptOutAt_idx" ON "PatientBalance"("smsOptOutAt");
