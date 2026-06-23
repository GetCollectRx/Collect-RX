-- Phase 2 — MOD-01 / MOD-04 (CDCP reconsideration tracking + PMS write-back audit trail)

CREATE TABLE "CdcpReconsiderationCase" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "claimRef" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL DEFAULT 'cdcp_sunlife',
    "procedureCode" TEXT,
    "denialDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "exclusionReason" TEXT,
    "clinicalEvidenceSummary" TEXT,
    "originalAdjudicatorHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CdcpReconsiderationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CdcpReconsiderationCase_practiceId_claimRef_key" ON "CdcpReconsiderationCase"("practiceId", "claimRef");
CREATE INDEX "CdcpReconsiderationCase_practiceId_denialDate_idx" ON "CdcpReconsiderationCase"("practiceId", "denialDate");
CREATE INDEX "CdcpReconsiderationCase_practiceId_status_idx" ON "CdcpReconsiderationCase"("practiceId", "status");
CREATE INDEX "CdcpReconsiderationCase_patientToken_idx" ON "CdcpReconsiderationCase"("patientToken");

CREATE TABLE "PmsWritebackLog" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "claimRef" TEXT NOT NULL,
    "abeldentPatientId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmsWritebackLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PmsWritebackLog_practiceId_createdAt_idx" ON "PmsWritebackLog"("practiceId", "createdAt");
CREATE INDEX "PmsWritebackLog_claimRef_idx" ON "PmsWritebackLog"("claimRef");
