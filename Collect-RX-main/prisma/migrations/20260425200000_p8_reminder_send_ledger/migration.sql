-- P8-04: idempotent daily reminder processing across BullMQ retries
CREATE TABLE "ReminderSendLedger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSendLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReminderSendLedger_createdAt_idx" ON "ReminderSendLedger"("createdAt");
