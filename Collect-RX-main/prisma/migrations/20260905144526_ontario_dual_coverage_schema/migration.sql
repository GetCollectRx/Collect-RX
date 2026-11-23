-- CreateEnum
CREATE TYPE "payer_type" AS ENUM ('PRIVATE', 'CDCP', 'PROVINCIAL');

-- AlterTable
ALTER TABLE "insurance_claims" ADD COLUMN     "payer_type" "payer_type",
ADD COLUMN     "treating_dentist_id" TEXT;

-- CreateTable
CREATE TABLE "dentists" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "provider_number" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dentists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdcp_coverage" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_token" TEXT NOT NULL,
    "co_pay_tier" INTEGER NOT NULL,
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdcp_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cob_routes" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "secondary_payer_type" "payer_type" NOT NULL,
    "secondary_carrier_name" TEXT NOT NULL,
    "secondary_filing_deadline" TIMESTAMP(3) NOT NULL,
    "auto_submitted" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cob_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dentists_provider_number_key" ON "dentists"("provider_number");

-- CreateIndex
CREATE UNIQUE INDEX "dentists_license_number_key" ON "dentists"("license_number");

-- CreateIndex
CREATE INDEX "dentists_practice_id_idx" ON "dentists"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "cdcp_coverage_patient_token_key" ON "cdcp_coverage"("patient_token");

-- CreateIndex
CREATE INDEX "cdcp_coverage_practice_id_idx" ON "cdcp_coverage"("practice_id");

-- CreateIndex
CREATE INDEX "cdcp_coverage_last_verified_at_idx" ON "cdcp_coverage"("last_verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "cob_routes_claim_id_key" ON "cob_routes"("claim_id");

-- CreateIndex
CREATE INDEX "cob_routes_secondary_filing_deadline_idx" ON "cob_routes"("secondary_filing_deadline");

-- CreateIndex
CREATE INDEX "insurance_claims_treating_dentist_id_idx" ON "insurance_claims"("treating_dentist_id");

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_treating_dentist_id_fkey" FOREIGN KEY ("treating_dentist_id") REFERENCES "dentists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdcp_coverage" ADD CONSTRAINT "cdcp_coverage_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cob_routes" ADD CONSTRAINT "cob_routes_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
