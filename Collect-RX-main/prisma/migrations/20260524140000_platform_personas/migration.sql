-- Platform personas: users, escalations, grants, break-glass audit

CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "user_role" TEXT NOT NULL,
    "practice_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");
CREATE INDEX "platform_users_user_role_idx" ON "platform_users"("user_role");

CREATE TABLE "call_escalations" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "call_attempt_id" TEXT,
    "claim_id" TEXT NOT NULL,
    "claim_ref" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "amount_claimed_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_by_staff_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_notes" TEXT,
    "attempt_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_escalations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_escalations_practice_id_status_idx" ON "call_escalations"("practice_id", "status");

CREATE TABLE "auditor_grants" (
    "id" TEXT NOT NULL,
    "auditor_user_id" TEXT NOT NULL,
    "practice_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auditor_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auditor_grants_auditor_user_id_practice_id_key" ON "auditor_grants"("auditor_user_id", "practice_id");

CREATE TABLE "platform_admin_practice_grants" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "granted_by_owner_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_practice_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admin_practice_grants_admin_user_id_practice_id_key" ON "platform_admin_practice_grants"("admin_user_id", "practice_id");

CREATE TABLE "break_glass_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "break_glass_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "break_glass_audit_logs_performed_at_idx" ON "break_glass_audit_logs"("performed_at" DESC);
