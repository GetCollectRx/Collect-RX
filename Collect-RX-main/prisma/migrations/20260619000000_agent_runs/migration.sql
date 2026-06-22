-- CreateTable: agent_runs — persists structured output from every autonomous agent run
CREATE TABLE "agent_runs" (
    "id"          TEXT NOT NULL,
    "agent_name"  TEXT NOT NULL,
    "run_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity"    TEXT NOT NULL,
    "score"       INTEGER,
    "summary"     TEXT NOT NULL,
    "findings"    JSONB NOT NULL DEFAULT '[]',
    "downstream"  JSONB NOT NULL DEFAULT '[]',
    "escalated"   BOOLEAN NOT NULL DEFAULT false,
    "raw"         JSONB,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runs_agent_name_run_at_idx" ON "agent_runs"("agent_name", "run_at");
CREATE INDEX "agent_runs_severity_run_at_idx"   ON "agent_runs"("severity", "run_at");
CREATE INDEX "agent_runs_run_at_idx"            ON "agent_runs"("run_at");
