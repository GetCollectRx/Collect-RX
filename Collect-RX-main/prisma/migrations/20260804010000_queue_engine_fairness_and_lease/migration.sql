-- AlterTable
ALTER TABLE "practice_desk_state" ADD COLUMN     "last_served_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "queue_engine_lease" (
    "id" TEXT NOT NULL,
    "locked_until" TIMESTAMP(3),
    "locked_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_engine_lease_pkey" PRIMARY KEY ("id")
);

