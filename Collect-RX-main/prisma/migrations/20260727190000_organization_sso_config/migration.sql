-- Phase 4 FR-1: one SAML 2.0 IdP connection per Organization.

CREATE TABLE "organization_sso_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "org_slug" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "sso_enforced" BOOLEAN NOT NULL DEFAULT false,
    "enforced_domains" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_sso_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_sso_configs_organization_id_key" ON "organization_sso_configs"("organization_id");
CREATE UNIQUE INDEX "organization_sso_configs_org_slug_key" ON "organization_sso_configs"("org_slug");

ALTER TABLE "organization_sso_configs" ADD CONSTRAINT "organization_sso_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
