-- Phase 4 FR-11: chain-of-custody record for auditor-facing org compliance exports.

CREATE TABLE "org_compliance_exports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "exported_by" TEXT NOT NULL,
    "date_range_from" TIMESTAMP(3) NOT NULL,
    "date_range_to" TIMESTAMP(3) NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_compliance_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_compliance_exports_organization_id_created_at_idx" ON "org_compliance_exports"("organization_id", "created_at");

ALTER TABLE "org_compliance_exports" ADD CONSTRAINT "org_compliance_exports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
