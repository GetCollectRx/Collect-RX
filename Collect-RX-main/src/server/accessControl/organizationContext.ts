import type { PrismaClient } from '@prisma/client';

/** Resolves the caller's org_admin organization, or null if they're not one. */
export async function callerAdminOrganizationId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: 'org_admin' },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/**
 * Resolves an organization the caller can view billing for — org_admin (full
 * access) or org_billing_viewer (the DSO controller/CFO persona, billing-only).
 * Route-level checks still gate everything else to org_admin specifically;
 * this only widens the two billing-read/portal routes.
 */
export async function callerBillingViewerOrganizationId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: { in: ['org_admin', 'org_billing_viewer'] } },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/** True if the caller holds any organization membership at all — used to admit them past the router's coarse role gate. */
export async function callerHasOrganizationMembership(prisma: PrismaClient, userId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findFirst({ where: { userId }, select: { id: true } });
  return membership !== null;
}

/**
 * True if the caller holds an org_billing_viewer membership — used to give a
 * real 403 instead of an empty-but-200 response on routes that must reject
 * this role explicitly (FR-8). Distinct from "not a member at all", which
 * legitimately returns an empty result rather than a 403.
 */
export async function callerIsBillingViewer(prisma: PrismaClient, userId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: 'org_billing_viewer' },
    select: { id: true },
  });
  return membership !== null;
}
