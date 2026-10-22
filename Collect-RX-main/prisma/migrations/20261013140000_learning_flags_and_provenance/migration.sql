-- Default-deny learning controls (policy research HP#14, PS#15; synthesis F12,
-- H12). Additive only: two boolean columns with DEFAULT false. Existing
-- practices are NOT opted in. Their transcripts stop feeding cross-tenant
-- lesson extraction on deploy until each practice sets the flag.

ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "learning_contribution" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "learning_consumption" BOOLEAN NOT NULL DEFAULT false;
