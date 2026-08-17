-- Lets the admin org-creation tool invite a practice owner while also
-- tagging the invite as DSO-scoped; accept-invite creates an
-- OrganizationMember row when organization_id is set.

ALTER TABLE "InviteToken" ADD COLUMN "organization_id" TEXT;

CREATE INDEX "InviteToken_organization_id_idx" ON "InviteToken"("organization_id");

ALTER TABLE "InviteToken"
  ADD CONSTRAINT "InviteToken_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
