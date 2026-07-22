-- CreateEnum
CREATE TYPE "carrier_lesson_category" AS ENUM ('IVR_NAVIGATION', 'REP_INTERACTION', 'HOLD_BEHAVIOR', 'REFUSAL', 'EXTRACTION');

-- CreateEnum
CREATE TYPE "carrier_lesson_status" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "carrier_lessons" (
    "id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "category" "carrier_lesson_category" NOT NULL,
    "observation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "carrier_lesson_status" NOT NULL DEFAULT 'PROPOSED',
    "source_call_attempt_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carrier_lessons_carrier_id_status_idx" ON "carrier_lessons"("carrier_id", "status");

-- CreateIndex
CREATE INDEX "carrier_lessons_status_created_at_idx" ON "carrier_lessons"("status", "created_at" DESC);

