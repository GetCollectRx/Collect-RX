-- CreateEnum
CREATE TYPE "carrier_channel_type" AS ENUM ('CLAIM_RESUBMISSION', 'DOCUMENTATION');

-- CreateTable
CREATE TABLE "carrier_submission_channels" (
    "id" TEXT NOT NULL,
    "carrier_id" "carrier_id" NOT NULL,
    "channel_type" "carrier_channel_type" NOT NULL,
    "submission_method" TEXT NOT NULL,
    "submission_destination" TEXT NOT NULL,
    "times_confirmed" INTEGER NOT NULL DEFAULT 1,
    "last_confirmed_at" TIMESTAMP(3) NOT NULL,
    "source_call_attempt_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_submission_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carrier_submission_channels_carrier_id_channel_type_key" ON "carrier_submission_channels"("carrier_id", "channel_type");
