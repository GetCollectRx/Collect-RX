-- Phase 4 FR-6 follow-up: SSO login failures and break-glass overrides,
-- which AuditLog's NOT NULL practiceId cannot hold for org-level events.

CREATE TABLE "org_sso_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "detail" TEXT,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_sso_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_sso_events_organization_id_created_at_idx" ON "org_sso_events"("organization_id", "created_at");

ALTER TABLE "org_sso_events" ADD CONSTRAINT "org_sso_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
