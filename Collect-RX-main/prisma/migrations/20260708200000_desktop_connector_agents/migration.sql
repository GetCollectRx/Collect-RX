-- Desktop connector agents: long-lived tokens + heartbeat telemetry for practice PCs.

CREATE TABLE "desktop_connector_agents" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Practice PC',
    "token_hash" TEXT NOT NULL,
    "hostname" TEXT,
    "agent_version" TEXT,
    "platform" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_message" TEXT,
    "last_imported" INTEGER,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_connector_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "desktop_connector_agents_practice_id_idx" ON "desktop_connector_agents"("practice_id");
