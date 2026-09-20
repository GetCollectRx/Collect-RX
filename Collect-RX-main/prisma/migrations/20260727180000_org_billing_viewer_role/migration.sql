-- Phase 4 FR-7/FR-9: DSO controller/CFO persona (billing visibility only).

ALTER TYPE "OrganizationRole" ADD VALUE 'org_billing_viewer';

ALTER TABLE "InviteToken" ADD COLUMN "org_role" "OrganizationRole";
