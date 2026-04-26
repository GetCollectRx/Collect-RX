-- P4-02: email opt-out (mirrors SMS smsOptOutAt) + bounce/spam from SendGrid webhook
ALTER TABLE "PatientBalance" ADD COLUMN "emailOptOutAt" TIMESTAMP(3);

CREATE INDEX "PatientBalance_emailOptOutAt_idx" ON "PatientBalance"("emailOptOutAt");
