import type { PrismaClient } from '@prisma/client';

/** Resolves the caller's org_admin organization, or null if they're not one. */
export async function callerAdminOrganizationId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: 'org_admin' },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}
