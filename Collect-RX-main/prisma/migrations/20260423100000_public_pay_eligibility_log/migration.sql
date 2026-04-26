-- AlterTable
ALTER TABLE "PatientBalance" ADD COLUMN "publicPayToken" TEXT;
ALTER TABLE "PatientBalance" ADD COLUMN "publicPayTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PatientBalance_publicPayToken_key" ON "PatientBalance"("publicPayToken");

-- CreateTable
CREATE TABLE "EligibilityEstimateLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "practiceId" TEXT,
    "patientId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "requestJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,

    CONSTRAINT "EligibilityEstimateLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EligibilityEstimateLog_patientId_carrier_idx" ON "EligibilityEstimateLog"("patientId", "carrier");
CREATE INDEX "EligibilityEstimateLog_createdAt_idx" ON "EligibilityEstimateLog"("createdAt");
