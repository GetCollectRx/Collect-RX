-- Phase 2 follow-up — desktop connector ack columns for PmsWritebackLog
ALTER TABLE "PmsWritebackLog" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "PmsWritebackLog" ADD COLUMN "processError" TEXT;

CREATE INDEX "PmsWritebackLog_practiceId_processedAt_idx"
  ON "PmsWritebackLog"("practiceId", "processedAt");
