-- P5-04: append-only audit for staff actions (no PHI in details; summaries only)
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "practiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "details" JSONB,
    "requestIp" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_practiceId_createdAt_idx" ON "AuditLog"("practiceId", "createdAt" DESC);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);
