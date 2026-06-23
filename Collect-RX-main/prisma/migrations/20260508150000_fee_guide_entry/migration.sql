-- MOD-03 — DB-backed fee guide entries (replaces bundled JSON when populated)
CREATE TABLE "FeeGuideEntry" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "cdtCode" TEXT NOT NULL,
    "feeCad" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeGuideEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeeGuideEntry_scope_effectiveDate_cdtCode_key"
    ON "FeeGuideEntry"("scope", "effectiveDate", "cdtCode");
CREATE INDEX "FeeGuideEntry_scope_cdtCode_idx"
    ON "FeeGuideEntry"("scope", "cdtCode");
