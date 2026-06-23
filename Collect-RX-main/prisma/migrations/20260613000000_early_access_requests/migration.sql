-- Lead capture for the public landing page (collectrx.ca) "Request Early
-- Access" / "Book a Demo" CTAs. Additive only.

CREATE TABLE IF NOT EXISTS "early_access_requests" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "email"         TEXT NOT NULL,
    "practice_name" TEXT,
    "phone"         TEXT,
    "intent"        TEXT NOT NULL DEFAULT 'access',
    "message"       TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "early_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "early_access_requests_created_at_idx" ON "early_access_requests"("created_at");
