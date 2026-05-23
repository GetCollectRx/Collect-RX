-- migrations/rbac-users-schema.sql
-- RBAC Phase: User accounts, roles, and AuditLog.userId
-- Run against Railway Postgres: psql $DATABASE_URL -f migrations/rbac-users-schema.sql

-- ─── PracticeRole enum ───────────────────────────────────────────────────────
CREATE TYPE "PracticeRole" AS ENUM (
  'practice_owner',
  'office_manager',
  'billing_coordinator',
  'front_desk',
  'associate_dentist',
  'accountant',
  'group_admin'
);

-- ─── User table ───────────────────────────────────────────────────────────────
CREATE TABLE "User" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "practiceId"     TEXT        NOT NULL,
  "email"          TEXT        NOT NULL,
  "passwordHash"   TEXT        NOT NULL,
  "role"           "PracticeRole" NOT NULL,
  "displayName"    TEXT        NOT NULL,
  "isActive"       BOOLEAN     NOT NULL DEFAULT TRUE,
  -- associate_dentist only: all queries scoped to this provider
  "providerId"     TEXT,
  -- accountant only: token invalid after this date
  "tokenExpiresAt" TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_email_key" UNIQUE ("email"),
  CONSTRAINT "User_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "User_practiceId_idx" ON "User"("practiceId");
CREATE INDEX "User_email_idx"      ON "User"("email");

-- Trigger to auto-update updatedAt
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_updatedAt"
  BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── AuditLog: add userId ─────────────────────────────────────────────────────
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx"
  ON "AuditLog"("userId", "createdAt");
