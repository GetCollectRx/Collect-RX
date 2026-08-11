-- CreateTable
CREATE TABLE "worker_dead_letters" (
    "id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "bull_job_id" TEXT,
    "payload" JSONB NOT NULL,
    "error_history" JSONB NOT NULL,
    "attempts_made" INTEGER NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retried_at" TIMESTAMP(3),
    "retried_by" TEXT,

    CONSTRAINT "worker_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worker_dead_letters_queue_name_job_name_idx" ON "worker_dead_letters"("queue_name", "job_name");

-- CreateIndex
CREATE INDEX "worker_dead_letters_created_at_idx" ON "worker_dead_letters"("created_at");
