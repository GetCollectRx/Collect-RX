-- P3-42: persist reconciliation results for audit and compare/replay
CREATE TABLE "EligibilityReconcileLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "practiceId" TEXT,
    "patientId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "claimId" TEXT,
    "adjudicationJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,

    CONSTRAINT "EligibilityReconcileLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EligibilityReconcileLog_estimateId_createdAt_idx" ON "EligibilityReconcileLog"("estimateId", "createdAt");
CREATE INDEX "EligibilityReconcileLog_patientId_createdAt_idx" ON "EligibilityReconcileLog"("patientId", "createdAt");
CREATE INDEX "EligibilityReconcileLog_createdAt_idx" ON "EligibilityReconcileLog"("createdAt");
